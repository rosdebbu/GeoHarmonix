import { describe, expect, test } from 'bun:test';
import { BUILTIN_TLES, nextPass, parseTle, positionEci, subpoint } from './live-orbits';

describe('live orbits', () => {
  const noaa20 = parseTle(BUILTIN_TLES.noaa20!);

  test('reads the epoch and period from a TLE', () => {
    expect(new Date(noaa20.epochMs).toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(((2 * Math.PI) / noaa20.n / 60)).toBeCloseTo(101.45, 1); // minutes per orbit
  });

  test('flies at about 830 km and never beyond its inclination', () => {
    for (let hours = 0; hours < 3; hours += 0.25) {
      const p = subpoint(noaa20, noaa20.epochMs + hours * 3_600_000);
      expect(p.altKm).toBeGreaterThan(780);
      expect(p.altKm).toBeLessThan(880);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(81.3); // 180 - 98.79 degrees
    }
  });

  test('returns near its start after one full orbit (in the inertial frame)', () => {
    const start = positionEci(noaa20, noaa20.epochMs);
    const end = positionEci(noaa20, noaa20.epochMs + ((2 * Math.PI) / noaa20.n) * 1000);
    expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])).toBeLessThan(60);
  });

  test('rejects a broken TLE', () => {
    expect(() => parseTle(['x', 'y'])).toThrow();
  });

  test('finds the next pass over the Mekong, and a swath is not over it before that', () => {
    const from = noaa20.epochMs;
    const pass = nextPass(noaa20, 105.8, 16, from, 3040)!;
    expect(pass.startMs).not.toBeNull();
    expect(pass.startMs!).toBeGreaterThan(from);
    expect(pass.endMs! - pass.startMs!).toBeLessThan(20 * 60_000); // a pass lasts minutes
    const midway = nextPass(noaa20, 105.8, 16, pass.peakMs!, 3040)!;
    expect(midway.inside).toBe(true);
  });
});
