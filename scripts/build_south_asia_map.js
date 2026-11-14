// Rebuilds the South Asia ("india": India, Bangladesh, Myanmar) region of map-data.json from the
// REAL flagged detections in apps/workbench/.cache/map-points.json
// (run `uv run python apps/workbench/scripts/flag-map-points.py` first).
// Country outlines are Natural Earth 1:110m; Mekong and Amazon are left as they are.
const fs = require('fs');
const path = require('path');
const d3 = require(path.resolve(__dirname, '../apps/workbench/node_modules/d3-geo'));
const topo = require(path.resolve(__dirname, '../apps/workbench/node_modules/topojson-client'));

const ROOT = path.resolve(__dirname, '..');
const MAP_DATA_PATH = path.join(ROOT, 'apps/workbench/src/data/map-data.json');
const COUNTRIES_PATH = path.join(ROOT, 'apps/workbench/countries-110m.json');
const POINTS_PATH = path.join(ROOT, 'apps/workbench/.cache/map-points.json');

const mapData = JSON.parse(fs.readFileSync(MAP_DATA_PATH, 'utf8'));
const world = JSON.parse(fs.readFileSync(COUNTRIES_PATH, 'utf8'));
const flagged = JSON.parse(fs.readFileSync(POINTS_PATH, 'utf8'));
if (!flagged.regions.india) throw new Error('map-points.json has no india region');

const WIDTH = 1000;
const HEIGHT = 730;
const PAD = { x: 450, y: 260 };

const indiaRegion = {
  bbox: [68.0, 6.5, 102.0, 37.5],
  queryBox: [68.0, 8.0, 101.2, 35.5],
  anchor: [83.0, 21.5],
  focus: ['356', '050', '104'], // India, Bangladesh, Myanmar
  staticSources: [
    { id: 'S-01', lon: 77.2, lat: 28.6 }, // Delhi NCR industrial / brick kilns
    { id: 'S-02', lon: 75.8, lat: 30.9 }, // Ludhiana industrial thermal
    { id: 'S-03', lon: 76.9, lat: 29.9 }, // Panipat refinery thermal
    { id: 'S-04', lon: 90.4, lat: 23.8 }, // Dhaka brick-kiln belt
  ],
};

const [west, south, east, north] = indiaRegion.bbox;
const fit = {
  type: 'MultiPoint',
  coordinates: [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ],
};

const projection = d3.geoAzimuthalEqualArea()
  .rotate([-(west + east) / 2, -(south + north) / 2])
  .fitExtent(
    [
      [26, 26],
      [WIDTH - 26, HEIGHT - 26],
    ],
    fit
  );

projection.clipExtent([
  [-PAD.x, -PAD.y],
  [WIDTH + PAD.x, HEIGHT + PAD.y],
]);

const projectPath = d3.geoPath(projection).digits(2);

function intersects(a, b) {
  return !(a[1][0] < b[0] || a[0][0] > b[2] || a[1][1] < b[1] || a[0][1] > b[3]);
}

function haversineKm(a, b) {
  const radius = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

const center = [(west + east) / 2, (south + north) / 2];
const eastPt = [center[0] + 0.01, center[1]];
const p1 = projection(center);
const p2 = projection(eastPt);
const pxPerKm = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / haversineKm(center, eastPt);

const [qw, qs, qe, qn] = indiaRegion.queryBox;
const queryRing = [
  [qw, qs],
  [qw, qn],
  [qe, qn],
  [qe, qs],
  [qw, qs],
];

const countries = topo.feature(world, world.objects.countries).features;
const visible = countries.filter((country) => intersects(d3.geoBounds(country), indiaRegion.bbox));

const land = topo.merge(
  world,
  world.objects.countries.geometries.filter((geom) =>
    visible.some((country) => String(country.id) === String(geom.id))
  )
);

const coverage = topo.merge(
  world,
  world.objects.countries.geometries.filter((geom) =>
    indiaRegion.focus.includes(String(geom.id))
  )
);

const borders = topo.mesh(world, world.objects.countries, (a, b) => a !== b);
const graticule = d3.geoGraticule10();

const epochs = {};
const counts = {};
for (const [year, epoch] of Object.entries(flagged.regions.india)) {
  epochs[year] = epoch.points
    .map(([lon, lat, sensor, flags, scan, track, angle, platform, daynight], i) => {
      const p = projection([lon, lat]);
      if (!p) return null;
      return {
        i,
        x: Math.round(p[0] * 10) / 10,
        y: Math.round(p[1] * 10) / 10,
        s: sensor,
        f: flags,
        sc: scan,
        tr: track,
        ang: angle,
        pf: platform,
        dn: daynight,
      };
    })
    .filter(Boolean);
  counts[year] = epoch.counts;
}

const staticSources = indiaRegion.staticSources.map((source) => {
  const projected = projection([source.lon, source.lat]);
  return projected ? { id: source.id, x: projected[0], y: projected[1] } : null;
}).filter(Boolean);

mapData.regions.india = {
  bbox: indiaRegion.bbox,
  queryBox: indiaRegion.queryBox,
  queryBoxPath: projectPath({ type: 'Polygon', coordinates: [queryRing] }),
  pxPerKm,
  saaPath: '',
  coveragePath: projectPath(coverage),
  landPath: projectPath(land),
  rivers: '',
  lakes: '',
  islands: [],
  staticSources,
  countries: visible.map((c) => ({
    id: String(c.id),
    d: projectPath(c),
    focus: indiaRegion.focus.includes(String(c.id)),
  })),
  borders: projectPath(borders),
  graticule: projectPath(graticule),
  epochs,
  counts,
};

fs.writeFileSync(MAP_DATA_PATH, JSON.stringify(mapData), 'utf8');
console.log('   -> map-data.json updated successfully with India region, projection & points.');
