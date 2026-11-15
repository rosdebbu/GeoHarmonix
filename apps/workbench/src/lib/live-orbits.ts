// Real satellite positions from public orbital elements (two-line elements, TLEs).
// A plain two-body orbit with J2 drift: good to a few km within a day or two of the TLE epoch,
// which is plenty to draw where a satellite is on a globe. Not an SGP4 tracker.

const MU = 398600.4418; // km^3 / s^2
const RE = 6378.137; // km
const J2 = 1.08263e-3;
const TAU = Math.PI * 2;

export type Craft = {
  id: string;
  label: string;
  norad: number;
  /** Which FIRMS sensor group this satellite feeds (see lib/nasa-feed.ts). */
  sensor: 'noaa21' | 'noaa20' | 'snpp' | 'modis';
  /** Width of the strip the instrument sees on the ground, km (VIIRS 3040, MODIS 2330). */
  swathKm: number;
};

export const CRAFT: readonly Craft[] = [
  { id: 'snpp', label: 'Suomi NPP', norad: 37849, sensor: 'snpp', swathKm: 3040 },
  { id: 'noaa20', label: 'NOAA-20', norad: 43013, sensor: 'noaa20', swathKm: 3040 },
  { id: 'noaa21', label: 'NOAA-21', norad: 54234, sensor: 'noaa21', swathKm: 3040 },
  { id: 'terra', label: 'Terra', norad: 25994, sensor: 'modis', swathKm: 2330 },
  { id: 'aqua', label: 'Aqua', norad: 27424, sensor: 'modis', swathKm: 2330 },
];

export type Tle = readonly [line1: string, line2: string];

/** TLEs pulled from CelesTrak on 2026-11-15; used until fresh ones arrive (accuracy fades over days). */
export const BUILTIN_TLES: Record<string, Tle> = {
  snpp: [
    '1 37849U 11061A   26319.17930513  .00000093  00000+0  65061-4 0  9993',
    '2 37849  98.8119 259.1138 0000735 235.4226 124.6881 14.19543400779865',
  ],
  noaa20: [
    '1 43013U 17073A   26319.05233444  .00000074  00000+0  55954-4 0  9997',
    '2 43013  98.7928 257.2567 0001210 129.4589 230.6694 14.19537205465879',
  ],
  noaa21: [
    '1 54234U 22150A   26319.08276326  .00000079  00000+0  58248-4 0  9999',
    '2 54234  98.7208 255.4087 0002685 108.8787 251.2681 14.19559060207953',
  ],
  terra: [
    '1 25994U 99068A   26319.15596123  .00000336  00000+0  77244-4 0  9993',
    '2 25994  97.9263   2.5685 0003554 106.4290 329.3302 14.61197921431654',
  ],
  aqua: [
    '1 27424U 02022A   26319.20786580  .00000779  00000+0  16423-3 0  9993',
    '2 27424  98.4494 291.6788 0001190 107.5368 263.2098 14.62281261305349',
  ],
};

export type Elements = {
  epochMs: number;
  inc: number;
  raan: number;
  ecc: number;
  argp: number;
  m0: number;
  /** Mean motion, rad/s. */
  n: number;
};

const rad = (deg: number) => (deg * Math.PI) / 180;

export function parseTle([l1, l2]: Tle): Elements {
  const yy = Number(l1.slice(18, 20));
  const day = Number(l1.slice(20, 32));
  const field = (from: number, to: number) => Number(l2.slice(from, to));
  if (![yy, day, field(8, 16), field(52, 63)].every(Number.isFinite)) throw new Error('bad TLE');
  return {
    epochMs: Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (day - 1) * 86_400_000,
    inc: rad(field(8, 16)),
    raan: rad(field(17, 25)),
    ecc: Number(`0.${l2.slice(26, 33).trim()}`),
    argp: rad(field(34, 42)),
    m0: rad(field(43, 51)),
    n: (field(52, 63) * TAU) / 86_400,
  };
}

/** Greenwich sidereal angle in radians at a time. */
export function gmst(ms: number): number {
  const days = ms / 86_400_000 + 2440587.5 - 2451545;
  const deg = 280.46061837 + 360.98564736629 * days + 0.000387933 * (days / 36525) ** 2;
  return rad(((deg % 360) + 360) % 360);
}

/** Position in the inertial (ECI) frame, in kilometres. */
export function positionEci(el: Elements, ms: number): [number, number, number] {
  const a = (MU / el.n ** 2) ** (1 / 3);
  const p = a * (1 - el.ecc ** 2);
  const dt = (ms - el.epochMs) / 1000;
  const k = J2 * (RE / p) ** 2 * el.n;
  const raan = el.raan - 1.5 * k * Math.cos(el.inc) * dt;
  const argp = el.argp + 0.75 * k * (5 * Math.cos(el.inc) ** 2 - 1) * dt;
  const mean = el.m0 + el.n * dt;
  let ecAnomaly = mean;
  for (let i = 0; i < 6; i += 1) ecAnomaly = mean + el.ecc * Math.sin(ecAnomaly);
  const xp = a * (Math.cos(ecAnomaly) - el.ecc);
  const yp = a * Math.sqrt(1 - el.ecc ** 2) * Math.sin(ecAnomaly);
  const [co, so, cw, sw, ci, si] = [Math.cos(raan), Math.sin(raan), Math.cos(argp), Math.sin(argp), Math.cos(el.inc), Math.sin(el.inc)];
  return [
    (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp,
    (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Where on Earth the satellite is directly above, plus its height in km. */
export function subpoint(el: Elements, ms: number): { lat: number; lon: number; altKm: number } {
  const [x, y, z] = positionEci(el, ms);
  const lon = ((((Math.atan2(y, x) - gmst(ms)) * 180) / Math.PI + 540) % 360) - 180;
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lon, altKm: Math.hypot(x, y, z) - RE };
}

export const EARTH_RADIUS_KM = RE;

const distanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const [p1, p2, dl] = [rad(lat1), rad(lat2), rad(lon2 - lon1)];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(h)));
};

export type Pass = {
  /** The satellite's swath is over the point right now. */
  inside: boolean;
  /** When it comes into view (null when already inside). */
  startMs: number | null;
  /** When it leaves view. */
  endMs: number | null;
  /** Closest approach of the pass that was found (null when already inside). */
  peakMs: number | null;
};

/** Next time the satellite's swath covers a point, scanning up to `horizonH` hours ahead. */
export function nextPass(el: Elements, lon: number, lat: number, fromMs: number, swathKm: number, horizonH = 26): Pass | null {
  const half = swathKm / 2;
  const step = 30_000;
  const near = (t: number) => {
    const s = subpoint(el, t);
    return distanceKm(s.lat, s.lon, lat, lon);
  };
  let t = fromMs;
  const end = fromMs + horizonH * 3_600_000;
  const inside = near(t) <= half;
  let startMs: number | null = inside ? null : -1;
  let best = Infinity;
  let peakMs: number | null = null;
  for (; t <= end; t += step) {
    const d = near(t);
    if (startMs === -1) {
      if (d > half) continue;
      startMs = t;
    }
    if (d < best) [best, peakMs] = [d, t];
    if (d > half) return { inside, startMs: inside ? null : startMs, endMs: t, peakMs: inside ? null : peakMs };
  }
  return startMs === -1 ? null : { inside, startMs: inside ? null : startMs, endMs: null, peakMs: inside ? null : peakMs };
}
