/** Fire power (FRP, MW) -> 0..1 on a log scale: most fires are a few MW, the rare big ones 100+. */
const TOP_MW = 120;

export function powerT(mw: number): number {
  return Math.min(1, Math.max(0, Math.log10(1 + Math.max(mw, 0)) / Math.log10(1 + TOP_MW)));
}

// Weak = dark red, strong = near-white yellow: brighter reads as hotter on the dark map.
const STOPS: [number, [number, number, number]][] = [
  [0, [122, 31, 18]],
  [0.35, [226, 70, 28]],
  [0.65, [255, 154, 46]],
  [0.85, [255, 216, 74]],
  [1, [255, 246, 201]],
];

export function powerColor(mw: number): string {
  const t = powerT(mw);
  for (let i = 1; i < STOPS.length; i += 1) {
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(' ')})`;
    }
  }
  return 'rgb(255 246 201)';
}

export const POWER_GRADIENT =
  'linear-gradient(90deg, rgb(122 31 18), rgb(226 70 28) 35%, rgb(255 154 46) 65%, rgb(255 216 74) 85%, rgb(255 246 201))';
