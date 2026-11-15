import { MAP_DATA } from './map-data';
import { REGION_DEFS, type RegionDef } from './regions';
import type { RegionId } from '@/lib/calendar/types';

const RAD = Math.PI / 180;

/**
 * The Lambert azimuthal equal-area projection the map data was built with
 * (scripts/build-map-data.mjs: centred on the region's box, fitted to the viewBox minus a 26 px
 * margin), both ways: longitude/latitude to map units, and map units back to longitude/latitude.
 */
export function mapProjection(region: RegionId) {
  const def: RegionDef = REGION_DEFS[region];
  const [west, south, east, north] = def.bbox;
  const l0 = ((west + east) / 2) * RAD;
  const p0 = ((south + north) / 2) * RAD;
  const raw = ([lon, lat]: readonly [number, number]): [number, number] => {
    const dl = lon * RAD - l0;
    const p = lat * RAD;
    const k = Math.sqrt(2 / (1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl)));
    return [k * Math.cos(p) * Math.sin(dl), -k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl))];
  };
  const fit = [[west, south], [east, south], [east, north], [west, north], ...(def.fit ?? [])] as [number, number][];
  const corners = fit.map(raw);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = 26;
  const scale = Math.min((MAP_DATA.width - 2 * margin) / (x1 - x0), (MAP_DATA.height - 2 * margin) / (y1 - y0));
  const tx = (MAP_DATA.width - scale * (x0 + x1)) / 2;
  const ty = (MAP_DATA.height - scale * (y0 + y1)) / 2;

  const forward = (lonLat: [number, number]): [number, number] => {
    const [x, y] = raw(lonLat);
    return [scale * x + tx, scale * y + ty];
  };
  /** Map units (the viewBox) back to [longitude, latitude]. */
  const inverse = (X: number, Y: number): [number, number] => {
    const x = (X - tx) / scale;
    const y = -((Y - ty) / scale);
    const rho = Math.hypot(x, y);
    if (rho === 0) return [l0 / RAD, p0 / RAD];
    const c = 2 * Math.asin(Math.min(1, rho / 2));
    const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho);
    const lon = l0 + Math.atan2(x * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
    return [lon / RAD, lat / RAD];
  };
  return { forward, inverse };
}

/** The longitude/latitude box [west, south, east, north] of a box in map units. */
export function lonLatBox(region: RegionId, box: readonly number[]): [number, number, number, number] {
  const { inverse } = mapProjection(region);
  const [x0, y0, x1, y1] = box as [number, number, number, number];
  const corners = [inverse(x0, y0), inverse(x1, y0), inverse(x0, y1), inverse(x1, y1)];
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
