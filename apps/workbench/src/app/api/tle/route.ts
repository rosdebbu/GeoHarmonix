// Fresh orbital elements for the five FIRMS satellites from CelesTrak (public, asks for at most
// one pull every couple of hours, so this is cached for six). The browser falls back to the
// elements built into lib/live-orbits.ts when this cannot answer.
import { CRAFT, parseTle, type Tle } from '@/lib/live-orbits';

const TTL_MS = 6 * 3_600_000;
type Cached = { at: number; body: { fetchedAt: string; tles: Record<string, Tle> } };
let cache: Cached | null = null;
let inflight: Promise<Cached> | null = null;

async function one(norad: number): Promise<Tle | null> {
  try {
    const response = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=tle`, {
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const lines = (await response.text()).split(/\r?\n/).filter((line) => line.trim());
    const tle: Tle = [lines[1] ?? '', lines[2] ?? ''];
    parseTle(tle); // throws on anything that is not a real TLE
    return tle;
  } catch {
    return null;
  }
}

async function pull(): Promise<Cached> {
  const tles: Record<string, Tle> = { ...(cache?.body.tles ?? {}) };
  const got = await Promise.all(CRAFT.map(async (craft) => [craft.id, await one(craft.norad)] as const));
  for (const [id, tle] of got) if (tle) tles[id] = tle;
  // Only the satellites that answered are replaced; a partial answer still beats none.
  const next = { at: Date.now(), body: { fetchedAt: new Date().toISOString(), tles } };
  if (got.some(([, tle]) => tle)) cache = next;
  return cache ?? next;
}

export async function GET() {
  // A complete set is kept for six hours; an incomplete one is retried after five minutes.
  const complete = cache && CRAFT.every((craft) => cache!.body.tles[craft.id]);
  if (cache && Date.now() - cache.at < (complete ? TTL_MS : 5 * 60_000)) return Response.json(cache.body);
  inflight ??= pull().finally(() => {
    inflight = null;
  });
  return Response.json((await inflight).body);
}
