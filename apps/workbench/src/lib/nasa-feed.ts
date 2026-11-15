// Server-only: NASA FIRMS near-real-time detections for a region's satellites.
//
// Uses FIRMS' area API with the project's FIRMS_MAP_KEY: it returns only the region's box for
// the last few days (tens of KB), where the public 7-day files are 0.4-1.4 MB each and stall on
// slow or throttled networks. Be gentle with NASA: one pull per region per 10 minutes, a pause
// after a failure, and the last good data per satellite is kept and shown with its real age.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REGION_DEFS } from '@/lib/workbench/regions';

const SENSORS = [
  { id: 'noaa21', label: 'NOAA-21 · VIIRS', source: 'VIIRS_NOAA21_NRT' },
  { id: 'noaa20', label: 'NOAA-20 · VIIRS', source: 'VIIRS_NOAA20_NRT' },
  { id: 'snpp', label: 'Suomi NPP · VIIRS', source: 'VIIRS_SNPP_NRT' },
  { id: 'modis', label: 'Terra/Aqua · MODIS', source: 'MODIS_NRT' },
] as const;
const API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const DAYS = 3; // covers the panel's 72 h window; the API allows up to 5
const KEEP = 3000; // newest detections kept per satellite
const TTL_MS = 10 * 60_000;
const RETRY_AFTER_FAIL_MS = 2 * 60_000;
const FORCE_MIN_GAP_MS = 60_000; // "Refresh now" cannot hammer NASA
// Outside the project: a file written inside it makes `next dev` recompile and reload the page.
const SNAPSHOT_DIR = path.join(os.tmpdir(), 'flare-chronos');

export type Detection = { lat: number; lon: number; frp: number; at: string };
export type FeedSensor = {
  id: string;
  label: string;
  latest: string | null;
  /** When this satellite's data was last pulled from NASA successfully. */
  pulledAt: string | null;
  /** The most recent attempt failed; `recent` is then the last good data, if any. */
  error: boolean;
  recent: Detection[];
};
export type Feed = { region: string; checked: string; keyMissing: boolean; sensors: FeedSensor[] };

const memory = new Map<string, Feed>();
const inflight = new Map<string, Promise<Feed>>();
const retryAt = new Map<string, number>();
let cachedKey: string | null | undefined;

function mapKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  let key = process.env.FIRMS_MAP_KEY?.trim() || null;
  // The workbench runs two folders below the repo's .env
  for (const dir of ['.', '..', '../..']) {
    if (key) break;
    try {
      const line = readFileSync(path.join(process.cwd(), dir, '.env'), 'utf8')
        .split(/\r?\n/)
        .find((row) => row.startsWith('FIRMS_MAP_KEY='));
      key = line?.slice('FIRMS_MAP_KEY='.length).trim().replace(/^"|"$/g, '') || null;
    } catch {
      /* no .env here */
    }
  }
  cachedKey = key;
  return key;
}

/** Parses a FIRMS area CSV by column name, so a reordered or extended file still reads right. */
export function parseFirms(csv: string): Detection[] {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const columns = (head ?? '').split(',');
  const at = (name: string) => columns.indexOf(name);
  const [iLat, iLon, iDate, iTime, iFrp] = ['latitude', 'longitude', 'acq_date', 'acq_time', 'frp'].map(at);
  if ([iLat, iLon, iDate, iTime, iFrp].includes(-1)) throw new Error('not a FIRMS CSV');
  const out: Detection[] = [];
  for (const row of rows) {
    const cells = row.split(',');
    if (!/^\d{4}-\d\d-\d\d$/.test(cells[iDate] ?? '')) continue;
    const time = (cells[iTime] ?? '').padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1:$2');
    out.push({
      lat: Number(cells[iLat]),
      lon: Number(cells[iLon]),
      frp: Number(cells[iFrp]) || 0,
      at: `${cells[iDate]}T${time}:00Z`,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, KEEP);
}

async function readSensor(
  sensor: (typeof SENSORS)[number],
  region: string,
  key: string,
  before: FeedSensor | undefined,
): Promise<FeedSensor> {
  const [west, south, east, north] = REGION_DEFS[region as keyof typeof REGION_DEFS].queryBox;
  try {
    const response = await fetch(`${API}/${key}/${sensor.source}/${west},${south},${east},${north}/${DAYS}`, {
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(String(response.status));
    const recent = parseFirms(await response.text());
    return {
      id: sensor.id,
      label: sensor.label,
      latest: recent[0]?.at ?? null,
      pulledAt: new Date().toISOString(),
      error: false,
      recent,
    };
  } catch {
    // Keep what we had: a failed pull must not blank good data.
    return before
      ? { ...before, error: true }
      : { id: sensor.id, label: sensor.label, latest: null, pulledAt: null, error: true, recent: [] };
  }
}

function pull(region: string): Promise<Feed> {
  const running = inflight.get(region);
  if (running) return running;
  const key = mapKey();
  const before = memory.get(region);
  if (!key) {
    return Promise.resolve({
      region,
      checked: new Date().toISOString(),
      keyMissing: true,
      sensors: SENSORS.map((s) => ({ id: s.id, label: s.label, latest: null, pulledAt: null, error: true, recent: [] })),
    });
  }
  const job = Promise.all(
    SENSORS.map((sensor) => readSensor(sensor, region, key, before?.sensors.find((s) => s.id === sensor.id))),
  )
    .then(async (sensors) => {
      const feed: Feed = { region, checked: new Date().toISOString(), keyMissing: false, sensors };
      memory.set(region, feed);
      retryAt.set(region, Date.now() + (sensors.some((s) => s.error) ? RETRY_AFTER_FAIL_MS : TTL_MS));
      await mkdir(SNAPSHOT_DIR, { recursive: true }).catch(() => undefined);
      await writeFile(path.join(SNAPSHOT_DIR, `nasa-${region}.json`), JSON.stringify(feed)).catch(() => undefined);
      return feed;
    })
    .finally(() => inflight.delete(region));
  inflight.set(region, job);
  return job;
}

async function snapshot(region: string): Promise<Feed | null> {
  try {
    const feed = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, `nasa-${region}.json`), 'utf8')) as Feed;
    return Array.isArray(feed.sensors) ? feed : null;
  } catch {
    return null;
  }
}

/** Instant when anything is known; waits for NASA only the very first time. */
export async function getFeed(region: string, force = false): Promise<Feed> {
  const known = memory.get(region) ?? (await snapshot(region));
  if (!known) return pull(region);
  memory.set(region, known);
  const age = Date.now() - Date.parse(known.checked);
  const wait = known.sensors.some((s) => s.error) ? RETRY_AFTER_FAIL_MS : TTL_MS;
  const due = Date.now() >= (retryAt.get(region) ?? Date.parse(known.checked) + wait);
  if (force && age > FORCE_MIN_GAP_MS) return pull(region);
  if (due) void pull(region); // refresh behind the answer
  return known;
}

export const REGIONS = Object.keys(REGION_DEFS);

/** Start-up warm-up, one region after another so NASA sees a trickle, not a burst. */
export async function warmFeeds(): Promise<void> {
  for (const region of REGIONS) await getFeed(region).catch(() => undefined);
}
