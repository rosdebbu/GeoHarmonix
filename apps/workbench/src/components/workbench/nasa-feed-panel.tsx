'use client';

import { SectionHeading } from '@/components/ui/section-heading';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { MAP_DATA } from '@/lib/workbench/map-data';
import { REGION_DEFS } from '@/lib/workbench/regions';
import { mapProjection } from '@/lib/workbench/map-geo';
import { NasaMap } from './nasa-map';
import { BUILTIN_TLES, CRAFT, nextPass, parseTle, type Elements, type Tle } from '@/lib/live-orbits';
import type { RegionId } from '@/lib/calendar/types';

type Detection = { lat: number; lon: number; frp: number; at: string };
type Sensor = {
  id: string;
  label: string;
  latest: string | null;
  pulledAt: string | null;
  recent: Detection[];
  error: boolean;
};
type Feed = { checked: string; keyMissing: boolean; sensors: Sensor[] };

const REFRESH_MS = 10 * 60_000; // the server refreshes NASA every 10 min; asking more often gains nothing
const LIVE_H = 12; // a polar orbiter passes a region every few hours
const DELAYED_H = 48;
const WINDOWS = [6, 24, 72] as const;
const SPEEDS = [1, 60, 300] as const; // satellites fly this many times faster than real time
const LiveGlobe = dynamic(() => import('./live-globe').then((m) => m.LiveGlobe), {
  ssr: false,
  loading: () => <div className="fc-live-view border-line bg-canvas w-full rounded-md border" />,
});
const REPLAY_MS = 12_000;
const TINT: Record<string, string> = {
  noaa21: 'var(--cyan)',
  noaa20: 'var(--raw)',
  snpp: 'var(--purple)',
  modis: 'var(--amber)',
};

function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

// South and Southeast Asia as one live picture: the three measured regions together cover it.
const ASIA_REGIONS: RegionId[] = ['india', 'mekong', 'maritime'];
const ASIA_BBOX: [number, number, number, number] = [66, -11, 141, 36];

function mergeFeeds(feeds: Feed[]): Feed {
  if (feeds.length === 1) return feeds[0]!;
  return {
    checked: feeds.map((f) => f.checked).sort()[0]!,
    keyMissing: feeds.some((f) => f.keyMissing),
    sensors: feeds[0]!.sensors.map((first) => {
      const mine = feeds.flatMap((f) => f.sensors.filter((s) => s.id === first.id));
      const seen = new Set<string>();
      const recent = mine
        .flatMap((s) => s.recent)
        .filter((d) => {
          const key = `${d.lat},${d.lon},${d.at}`; // regions overlap; count a detection once
          return seen.has(key) ? false : (seen.add(key), true);
        })
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 9000);
      const pulled = mine.flatMap((s) => (s.pulledAt ? [s.pulledAt] : [])).sort();
      return { ...first, latest: recent[0]?.at ?? null, pulledAt: pulled[0] ?? null, error: mine.some((s) => s.error), recent };
    }),
  };
}

/** Ticks every second on its own, so the countdown never redraws the map. */
function Countdown({ nextAt, label }: { nextAt: number; label: (time: string) => string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const seconds = Math.max(0, Math.round((nextAt - now) / 1000));
  return <>{label(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)}</>;
}

/** Last panel of the page: NASA FIRMS detections arriving live, drawn on the region's own map. */
export function NasaFeedPanel({ region }: { region: RegionId }) {
  const t = useTranslations('Feed');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [nextAt, setNextAt] = useState(() => Date.now() + REFRESH_MS);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(24);
  const [cursor, setCursor] = useState<number | null>(null); // null = live (everything up to now)
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{ sensor: Sensor; d: Detection } | null>(null);
  const [view, setView] = useState<'nasa' | 'globe' | 'map'>('nasa');
  const [scope, setScope] = useState<'region' | 'asia'>('region');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const seen = useRef(0); // newest detection time at the previous poll, to mark what just arrived
  const [fresh, setFresh] = useState(0);

  const load = useCallback(
    (force: boolean) => {
      setLoading(true);
      const regions = scope === 'asia' ? ASIA_REGIONS : [region];
      return Promise.all(
        regions.map((id) =>
          fetch(`/api/nasa-feed?region=${id}${force ? '&fresh=1' : ''}`).then((response) =>
            response.ok ? (response.json() as Promise<Feed>) : Promise.reject(),
          ),
        ),
      )
        .then(mergeFeeds)
        .then((next) => {
          const newest = Math.max(
            0,
            ...next.sensors.map((sensor) => (sensor.latest ? Date.parse(sensor.latest) : 0)),
          );
          setFresh(seen.current);
          seen.current = Math.max(seen.current, newest);
          setFeed(next);
          setFailed(false);
          setNextAt(Date.now() + REFRESH_MS);
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    },
    [region, scope],
  );

  useEffect(() => {
    setFeed(null);
    setHover(null);
    setCursor(null);
    setPlaying(false);
    seen.current = 0;
    setFresh(0);
    void load(false);
    const poll = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(poll);
  }, [load]);

  // Once a minute is enough for "x min ago" and the time window; a faster tick redraws every dot.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Replay: sweep the cursor across the window, then go back to live.
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const from = Date.now() - hours * 3_600_000;
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / REPLAY_MS);
      setCursor(from + progress * (Date.now() - from));
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        setPlaying(false);
        setCursor(null);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, hours]);

  const toggle = useCallback((id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const data = MAP_DATA.regions[region];
  const project = useMemo(() => mapProjection(region).forward, [region]);
  const dots = useMemo(
    () =>
      (view !== 'map' ? [] : (feed?.sensors ?? [])).map((sensor) => ({
        sensor,
        points: sensor.recent.flatMap((d) => {
          const [x, y] = project([d.lon, d.lat]);
          const inside = x >= 0 && x <= MAP_DATA.width && y >= 0 && y <= MAP_DATA.height;
          return inside ? [{ d, x, y, ms: Date.parse(d.at) }] : [];
        }),
      })),
    [feed, project, view],
  );

  // Every detection of the visible satellites, oldest first: the globe draws a time slice of it.
  const globeList = useMemo(
    () =>
      (feed?.sensors ?? [])
        .filter((sensor) => !hidden.has(sensor.id))
        .flatMap((sensor) =>
          sensor.recent.map((d) => ({ sensor, d, point: { lat: d.lat, lon: d.lon, ms: Date.parse(d.at), sensor: sensor.id } })),
        )
        .sort((a, b) => a.point.ms - b.point.ms),
    [feed, hidden],
  );
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const globePoints = useMemo(() => globeList.map((item) => item.point), [globeList]);
  const handleGlobeHover = useCallback(
    (index: number | null, at?: { x: number; y: number }) => {
      setHover(index === null || !globeList[index] ? null : { sensor: globeList[index].sensor, d: globeList[index].d });
      setTip(at ?? null);
    },
    [globeList],
  );

  const span = hours * 3_600_000;
  const upTo = cursor ?? now;
  // When each satellite's swath is over this region, from real orbital elements (fresh ones when CelesTrak answers).
  const [tles, setTles] = useState<Record<string, Tle>>({});
  useEffect(() => {
    fetch('/api/tle')
      .then((response) => (response.ok ? (response.json() as Promise<{ tles: Record<string, Tle> }>) : null))
      .then((body) => body && setTles(body.tles))
      .catch(() => undefined);
  }, []);
  const passes = useMemo(() => {
    const [lon, lat] = scope === 'asia' ? [96, 17.8] : REGION_DEFS[region].anchor;
    return CRAFT.map((craft) => {
      let el: Elements;
      try {
        el = parseTle(tles[craft.id] ?? BUILTIN_TLES[craft.id]!);
      } catch {
        el = parseTle(BUILTIN_TLES[craft.id]!);
      }
      return { craft, pass: nextPass(el, lon, lat, now, craft.swathKm) };
    });
  }, [tles, region, scope, now]);
  const dur = (ms: number) => {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return minutes < 90 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  };

  // The numbers behind the dots on the globe: per satellite, in the chosen time window.
  const statsAt = useDeferredValue(upTo); // keeps Replay smooth: the numbers may trail the map by a frame
  const stats = useMemo(() => {
    const inWindow = globeList.filter((item) => item.point.ms <= statsAt && item.point.ms >= statsAt - span);
    const rows = (feed?.sensors ?? [])
      .filter((sensor) => !hidden.has(sensor.id))
      .map((sensor) => {
        const mine = inWindow.filter((item) => item.sensor.id === sensor.id);
        return { sensor, count: mine.length, mw: mine.reduce((sum, item) => sum + item.d.frp, 0) };
      });
    const top = inWindow.reduce<(typeof inWindow)[number] | null>((best, item) => (!best || item.d.frp > best.d.frp ? item : best), null);
    return { rows, top, count: inWindow.length, mw: rows.reduce((sum, row) => sum + row.mw, 0) };
  }, [globeList, feed, hidden, statsAt, span]);
  const windowed = dots.map(({ sensor, points }) => ({
    sensor,
    points: hidden.has(sensor.id) ? [] : points.filter((p) => p.ms <= upTo && p.ms >= upTo - span),
  }));
  const slowSince = feed?.sensors.find((sensor) => sensor.error && sensor.pulledAt)?.pulledAt ?? null;
  const slow = feed?.sensors.some((sensor) => sensor.error) ?? false;

  const state = (sensor: Sensor): 'live' | 'delayed' | 'silent' => {
    if (!sensor.latest) return 'silent';
    const age = (now - Date.parse(sensor.latest)) / 3_600_000;
    return age <= LIVE_H ? 'live' : age <= DELAYED_H ? 'delayed' : 'silent';
  };
  const dot = { live: 'var(--cyan)', delayed: 'var(--amber)', silent: 'var(--grey)' } as const;

  const tooltip =
    hover && tip ? (
      <div
        role="tooltip"
        className="text-micro bg-panel text-ink border-line pointer-events-none absolute z-10 rounded-md border px-2.5 py-1.5 font-mono"
        style={{ left: tip.x + 12, top: Math.max(4, tip.y - 56) }}
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true" className="size-2 rounded-sm" style={{ background: TINT[hover.sensor.id] }} />
          {hover.sensor.label}
        </p>
        <p>
          {hover.d.at.slice(0, 16).replace('T', ' ')} UTC · {ago(Date.parse(hover.d.at), upTo)} {t('agoSuffix')}
        </p>
        <p>
          {Math.abs(hover.d.lat).toFixed(3)}°{hover.d.lat >= 0 ? 'N' : 'S'} {Math.abs(hover.d.lon).toFixed(3)}°{hover.d.lon >= 0 ? 'E' : 'W'}
        </p>
        <p>{t('firePower', { mw: hover.d.frp })}</p>
      </div>
    ) : null;

  const segment = 'border-line-strong inline-flex items-center gap-0.5 rounded-md border p-0.5';
  const segmentButton = (on: boolean) =>
    `text-micro h-6 rounded-sm px-2 font-semibold ${on ? 'bg-seg text-ink' : 'text-ink-subtle hover:text-ink'}`;

  return (
    <section
      aria-labelledby="nasa-feed-title"
      className="border-line bg-panel mt-6 rounded-lg border p-3"
      data-testid="nasa-feed"
    >
      <header>
        <SectionHeading
          id="nasa-feed-title"
          icon="◉"
          title={t('title')}
          subtitle={t('note')}
          actions={
        <div className="flex items-center gap-2">
            <span className="text-micro text-ink-subtle font-mono">
              {loading ? t('loading') : failed ? t('failed') : <Countdown nextAt={nextAt} label={(time) => t('next', { time })} />}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(true)}
              className="border-line-strong text-micro text-ink-muted hover:bg-chip hover:text-ink rounded-md border px-2 py-1 disabled:opacity-50"
            >
              {t('refresh')}
            </button>
          </div>
          }
        />
      </header>
      {feed?.keyMissing && <p className="text-micro text-warn mt-1">{t('noKey')}</p>}
      {slow && !feed?.keyMissing && (
        <p className="text-micro text-warn mt-1" role="status">
          {slowSince ? t('slow', { ago: ago(Date.parse(slowSince), now) }) : t('slowNone')}
        </p>
      )}

      {feed && (
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
          {/* Main column: controls, then the chosen view */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div role="group" aria-label={t('view')} className={segment}>
                {(['nasa', 'globe', 'map'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => {
                      setView(value);
                      setHover(null);
                    }}
                    className={segmentButton(view === value)}
                  >
                    {t(value === 'nasa' ? 'viewNasa' : value === 'globe' ? 'viewGlobe' : 'viewMap')}
                  </button>
                ))}
              </div>
              <div role="group" aria-label={t('window')} className={segment}>
                {WINDOWS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={hours === value}
                    onClick={() => {
                      setHours(value);
                      setCursor(null);
                      setPlaying(false);
                    }}
                    className={`${segmentButton(hours === value)} font-mono`}
                  >
                    {value} h
                  </button>
                ))}
              </div>
              <div role="group" aria-label={t('scope')} className={segment}>
                {(['region', 'asia'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)} className={segmentButton(scope === value)}>
                    {t(value === 'region' ? 'scopeRegion' : 'scopeAsia')}
                  </button>
                ))}
              </div>
              {view === 'globe' && (
                <div role="group" aria-label={t('speed')} className={segment}>
                  <span className="text-micro text-ink-subtle px-1.5">{t('speed')}</span>
                  {SPEEDS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={speed === value}
                      onClick={() => setSpeed(value)}
                      className={`${segmentButton(speed === value)} font-mono`}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                <a
                  href={
                    scope === 'asia'
                      ? 'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@96.0,17.8,4.1z'
                      : `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${REGION_DEFS[region].anchor[0]},${REGION_DEFS[region].anchor[1]},5.5z`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-line-strong text-micro text-ink-muted hover:bg-chip hover:text-ink rounded-md border px-2.5 py-1"
                >
                  {t('openFirms')} ↗
                </a>
                <button
                  type="button"
                  onClick={() => setPlaying((value) => !value)}
                  className="border-line-strong text-micro text-ink-muted hover:bg-chip hover:text-ink rounded-md border px-2.5 py-1"
                >
                  {playing ? t('stop') : t('replay')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setCursor(null);
                  }}
                  aria-pressed={cursor === null}
                  className={`text-micro rounded-md border px-2 py-1 font-mono ${cursor === null ? 'border-cyan text-ink' : 'border-line-strong text-ink-muted'}`}
                >
                  {t('liveNow')}
                </button>
              </div>
            </div>
            <input
              type="range"
              aria-label={t('scrub')}
              min={now - span}
              max={now}
              step={60_000}
              value={cursor ?? now}
              onChange={(event) => {
                setPlaying(false);
                setCursor(Number(event.target.value));
              }}
              className="w-full"
            />
            <div className="text-micro text-ink-subtle flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono">
              <span>
                {t('inView', { count: stats.count })} · {new Date(upTo).toISOString().slice(5, 16).replace('T', ' ')} UTC
              </span>
              <span className="min-w-0 truncate">
                {hover
                  ? `${hover.sensor.label} · ${hover.d.lat.toFixed(3)}, ${hover.d.lon.toFixed(3)} · ${hover.d.frp} MW`
                  : t('hoverHint')}
              </span>
            </div>

            {view === 'nasa' ? (
              <NasaMap
                region={region}
                bbox={scope === 'asia' ? ASIA_BBOX : undefined}
                points={globePoints}
                from={upTo - span}
                to={upTo}
                onHover={handleGlobeHover}
              >
                {tooltip}
              </NasaMap>
            ) : view === 'globe' ? (
              <>
                <LiveGlobe
                  region={region}
                  points={globePoints}
                  from={upTo - span}
                  to={upTo}
                  speed={speed}
                  hiddenSensors={hidden}
                  onHover={handleGlobeHover}
                >
                  {tooltip}
                </LiveGlobe>
                <p className="text-micro text-ink-subtle">{t('orbitNote')}</p>
              </>
            ) : (
              <svg
                viewBox={`0 0 ${MAP_DATA.width} ${MAP_DATA.height}`}
                role="img"
                aria-label={t('plotLabel')}
                className="fc-live-plot border-line w-full overflow-hidden rounded-md border"
                style={{ background: 'var(--map-ocean)' }}
                onPointerLeave={() => setHover(null)}
              >
                <path d={data.graticule} fill="none" stroke="var(--map-grat)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {data.countries.map((country, index) => (
                  <path key={`${country.id}-${index}`} d={country.d} fill={country.focus ? 'var(--map-focus)' : 'var(--map-land)'} />
                ))}
                <path d={data.rivers} fill="none" stroke="var(--map-river)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <path d={data.borders} fill="none" stroke="var(--map-border)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                <path d={data.coveragePath} fill="none" stroke="var(--amber)" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {windowed.flatMap(({ sensor, points }) =>
                  points.map((p, i) => {
                    const age = Math.min(1, (upTo - p.ms) / span);
                    const isNew = p.ms > fresh && fresh > 0 && cursor === null;
                    return (
                      <g key={`${sensor.id}-${i}`} onPointerEnter={() => setHover({ sensor, d: p.d })}>
                        {isNew && (
                          <circle cx={p.x} cy={p.y} r={6} fill="none" stroke="var(--text)" strokeWidth={1.2}>
                            <animate attributeName="r" values="4;14" dur="1.6s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="1;0" dur="1.6s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={Math.min(9, 3 + Math.sqrt(p.d.frp) / 1.6)}
                          fill={TINT[sensor.id]}
                          fillOpacity={0.9 - 0.55 * age}
                          stroke="var(--map-ocean)"
                          strokeWidth={0.6}
                        />
                      </g>
                    );
                  }),
                )}
              </svg>
            )}
          </div>

          {/* Side column: what each satellite is doing, in plain rows */}
          <div className="flex min-w-0 flex-col gap-2">
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
              {feed.sensors.map((sensor) => {
                const s = state(sensor);
                const off = hidden.has(sensor.id);
                return (
                  <li key={sensor.id}>
                    <button
                      type="button"
                      aria-pressed={!off}
                      onClick={() => toggle(sensor.id)}
                      className={`border-line hover:bg-chip w-full rounded-md border px-2.5 py-1.5 text-left ${off ? 'opacity-50' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: dot[s] }} />
                        <span className="text-meta min-w-0 flex-1 truncate font-semibold">{sensor.label}</span>
                        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: TINT[sensor.id] }} />
                      </span>
                      <span className="text-micro text-ink block font-mono">
                        {sensor.latest
                          ? t('seen', { ago: ago(Date.parse(sensor.latest), now) })
                          : sensor.error
                            ? t('unreachable')
                            : t('empty')}
                      </span>
                      <span className="text-micro text-ink-subtle block font-mono">
                        {sensor.latest ? `${sensor.latest.slice(11, 16)} UTC · ` : ''}
                        {t(`status.${s}`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <aside aria-label={t('statsTitle', { hours })} className="border-line rounded-md border p-2.5">
              <h3 className="text-micro text-ink-subtle mb-1.5 font-mono tracking-widest uppercase">{t('statsTitle', { hours })}</h3>
              {stats.rows.map((row) => (
                <div key={row.sensor.id} className="text-micro flex items-center gap-1.5 py-0.5 font-mono">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: TINT[row.sensor.id] }} />
                  <span className="min-w-0 flex-1 truncate">{row.sensor.label}</span>
                  <span className="tabular-nums">{row.count}</span>
                  <span className="text-ink-subtle w-16 text-right tabular-nums">{Math.round(row.mw)} MW</span>
                </div>
              ))}
              <div className="text-micro border-line mt-1.5 flex justify-between border-t pt-1.5 font-mono font-semibold">
                <span>{t('statsTotal')}</span>
                <span className="tabular-nums">
                  {stats.count} · {Math.round(stats.mw)} MW
                </span>
              </div>
              {stats.top && (
                <p className="text-micro text-ink-muted mt-1.5">
                  {t('statsTop', {
                    mw: stats.top.d.frp,
                    lat: stats.top.d.lat.toFixed(2),
                    lon: stats.top.d.lon.toFixed(2),
                    ago: ago(Date.parse(stats.top.d.at), upTo),
                  })}
                </p>
              )}
            </aside>

            <aside aria-label={t('passTitle')} className="border-line rounded-md border p-2.5">
              <h3 className="text-micro text-ink-subtle mb-1.5 font-mono tracking-widest uppercase">{t('passTitle')}</h3>
              {passes.map(({ craft, pass }) => (
                <div key={craft.id} className="text-micro flex items-start gap-1.5 py-0.5 font-mono">
                  <span
                    aria-hidden="true"
                    className={`mt-1 size-2 shrink-0 rounded-full ${pass?.inside ? 'animate-pulse' : ''}`}
                    style={{ background: pass?.inside ? 'var(--ok)' : TINT[craft.sensor] }}
                  />
                  <span className="min-w-0">
                    <span className="font-semibold">{craft.label}</span>{' '}
                    <span className="text-ink-muted">
                      {!pass
                        ? t('passNone')
                        : pass.inside
                          ? t('passNow', { in: dur((pass.endMs ?? now) - now) })
                          : t('passNext', {
                              in: dur((pass.startMs ?? now) - now),
                              at: new Date(pass.peakMs ?? now).toISOString().slice(11, 16),
                            })}
                    </span>
                  </span>
                </div>
              ))}
            </aside>
          </div>
        </div>
      )}
      <p className="text-micro text-ink-subtle mt-2">{t('source')}</p>
    </section>
  );
}
