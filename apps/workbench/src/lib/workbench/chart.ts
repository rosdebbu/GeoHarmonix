/** A round upper bound and about five ticks for a bar or line axis starting at zero. */
export function axis(max: number): { top: number; ticks: number[] } {
  const raw = Math.max(max, 1e-9) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
  const top = Math.ceil(Math.max(max, 1e-9) / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6)) };
}
