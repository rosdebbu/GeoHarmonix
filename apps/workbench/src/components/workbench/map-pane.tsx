'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  MAP_DATA,
  loadEpochs,
  type MapPoint,
  MAP_FLAGS,
  type MapDetail,
  type MapHover,
  type MapSelect,
} from '@/lib/workbench/map-data';
import { displayResolution } from '@/lib/workbench/h3';
import { clampView, MAP_VIEW, zoomAt, type MapView } from '@/lib/workbench/map-view';
import { POWER_GRADIENT, powerColor } from '@/lib/workbench/map-power';
import { frame, viewFor, type MapPlace } from '@/lib/workbench/map-search';
import type { Epoch, MapFilters, MapLayers, MapPhysics } from '@/lib/workbench/types';
import { formatEpochDate, formatEpochDays } from '@/lib/workbench/format';
import type { RegionId } from '@/lib/calendar/types';
import { MapGuide } from './map-guide';
import { DEFAULT_LAYERS, MapControls, MapZoom } from './map-controls';
import { MapFooter, MapScale } from './map-legend';
import { MapDetailCard } from './map-detail-card';
import { NasaMap } from './nasa-map';
import type { GlobePoint } from './live-globe';
import { lonLatBox } from '@/lib/workbench/map-geo';

import { MapSearch } from './map-search';
import { MapTooltip } from './map-tooltip';
import { statusOf, WorkbenchMap } from './workbench-map';

/** Default framing: tight on the focus countries (kept as drawn when the region has labelled islands). */
function fitView(region: RegionId): MapView {
  const data = MAP_DATA.regions[region];
  if (data.islands.length > 0 || !data.fit) return MAP_VIEW;
  return frame(data.fit, MAP_DATA.width, MAP_DATA.height, 0.82, 4);
}

type MapPaneProps = {
  region: RegionId;
  regionLabel: string;
  epochs: Epoch[];
  physics: MapPhysics;
  year: number;
  filters: MapFilters;
  onFilter: (key: keyof MapFilters) => void;
  onYear: (year: number) => void;
};

export function MapPane({
  region,
  regionLabel,
  epochs,
  physics,
  year,
  filters,
  onFilter,
  onYear,
}: MapPaneProps) {
  const t = useTranslations('Map');
  const locale = useLocale();
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [grid, setGrid] = useState(7);
  const [view, setView] = useState<MapView>(() => fitView(region));
  const [hover, setHover] = useState<MapHover | null>(null);
  const [selected, setSelected] = useState<MapSelect | null>(null);
  const [details, setDetails] = useState<MapDetail[] | null>(null);
  const [place, setPlace] = useState<MapPlace | null>(null);
  const [mode, setMode] = useState<'plane' | 'sat'>('sat');
  const [flyTo, setFlyTo] = useState<{ key: string; box: [number, number, number, number] } | null>(null);
  const clamped = useMemo(() => clampView(view, MAP_DATA.width, MAP_DATA.height), [view]);
  const mapArea = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = mapArea.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scrollSelected = useCallback((node: HTMLButtonElement | null) => {
    const viewport = node?.parentElement;
    if (!node || !viewport) return;
    const box = node.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    if (box.left >= bounds.left && box.right <= bounds.right) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  const data = MAP_DATA.regions[region];
  const [epochDots, setEpochDots] = useState<Record<string, MapPoint[]>>({});
  useEffect(() => {
    let live = true;
    void loadEpochs(region).then((loaded) => live && setEpochDots(loaded));
    return () => {
      live = false;
    };
  }, [region]);
  const points = useMemo(() => epochDots[String(year)] ?? [], [epochDots, year]);
  const date = formatEpochDate(epochs.find((epoch) => epoch.year === year)?.date ?? null, locale);
  const resolution = displayResolution(view.k, grid);
  const drawnCount = useMemo(
    () => points.filter((point) => !(point.f & MAP_FLAGS.dup)).length,
    [points],
  );
  const scale =
    size.width > 0 ? Math.min(size.width / MAP_DATA.width, size.height / MAP_DATA.height) : 0;
  const pxPerKm = data.pxPerKm * scale * view.k;

  const zoom = useCallback(
    (factor: number) => {
      setView(
        zoomAt(
          view,
          factor,
          MAP_DATA.width / 2,
          MAP_DATA.height / 2,
          MAP_DATA.width,
          MAP_DATA.height,
        ),
      );
    },
    [view],
  );

  const toggleLayer = useCallback((layer: keyof MapLayers) => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    event.currentTarget.dataset.scrolled = event.currentTarget.scrollLeft > 4 ? 'true' : 'false';
  }, []);

  const handleEpochClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      setHover(null);
      onYear(Number(event.currentTarget.value));
    },
    [onYear],
  );

  const handleReset = useCallback(() => setView(fitView(region)), [region]);
  const closeDetail = useCallback(() => setSelected(null), []);

  // Picking a place flies the map to it and outlines it; clearing it leaves the view where it is.
  const handlePlace = useCallback((next: MapPlace | null) => {
    setPlace(next);
    if (next) {
      setView(viewFor(next, MAP_DATA.width, MAP_DATA.height));
      setFlyTo({ key: next.id, box: lonLatBox(region, next.b) });
    }
  }, [region]);
  const highlight =
    place?.kind === 'state'
      ? place.d
      : (MAP_DATA.regions[region].countries.find((country) => country.id === place?.cid)?.d ?? '');

  // A new region or epoch is a different set of dots: drop the pinned one.
  useEffect(() => {
    setSelected(null);
    setDetails(null);
  }, [region, year]);

  // Click-to-inspect detail is a small per-epoch file, fetched the first time a dot is picked.
  useEffect(() => {
    let live = true;
    fetch(`/map-detail/${region}-${year}.json`)
      .then((response) => (response.ok ? (response.json() as Promise<MapDetail[]>) : null))
      .then((rows) => {
        if (live) setDetails(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [region, year]);

  const handleOverlay = useCallback(() => toggleLayer('overlay'), [toggleLayer]);

  // The same sampled detections, placed by longitude/latitude for the satellite map.
  const sat = useMemo(() => {
    if (mode !== 'sat' || !details) return { entries: [] as MapSelect[], dots: [] as GlobePoint[] };
    const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const tint = { m: css('--amber'), v: css('--raw'), grey: css('--grey'), purple: css('--purple') };
    const entries: MapSelect[] = [];
    const dots: GlobePoint[] = [];
    for (const point of points) {
      const status = statusOf(point, filters);
      if (status === 'dup' || (status !== 'keep' && !layers.overlay)) continue;
      const row = details[point.i];
      if (!row) continue;
      const kept = status === 'keep';
      entries.push({ point, status });
      dots.push({
        lon: row[0],
        lat: row[1],
        ms: 0,
        sensor: point.s === 'm' ? 'modis' : 'viirs',
        ring: !kept,
        color: kept ? (layers.power ? powerColor(row[2]) : point.s === 'm' ? tint.m : tint.v) : status === 'static' ? tint.purple : tint.grey,
      });
    }
    return { entries, dots };
  }, [mode, details, points, filters, layers.overlay, layers.power]);

  const satHover = useCallback((index: number | null, at?: { x: number; y: number }) => {
    const entry = index === null ? null : sat.entries[index];
    const rect = mapArea.current?.getBoundingClientRect();
    setHover(entry && at && rect ? { ...entry, clientX: rect.left + at.x, clientY: rect.top + at.y } : null);
  }, [sat]);
  const satPick = useCallback((index: number | null) => setSelected(index === null ? null : (sat.entries[index] ?? null)), [sat]);
  const satSelected = selected ? sat.entries.findIndex((entry) => entry.point === selected.point) : -1;

  return (
    <section
      data-tour="map"
      aria-labelledby="map-title"
      className="fc-map-pane border-line bg-panel flex flex-col overflow-hidden rounded-lg border"
    >
      <header className="border-line flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
        <h2 id="map-title" className="text-body font-semibold">
          {t('title')}
        </h2>
        <span className="text-micro text-ink-subtle max-tablet:hidden font-mono tracking-widest uppercase">
          {t('equalArea')}
        </span>
        <div role="group" aria-label={t('viewMode')} className="border-line-strong inline-flex gap-0.5 rounded-md border p-0.5">
          {(['sat', 'plane'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`text-micro h-6 rounded-sm px-2 font-semibold ${mode === value ? 'bg-seg text-ink' : 'text-ink-subtle hover:text-ink'}`}
            >
              {t(value === 'sat' ? 'viewSat' : 'viewPlane')}
            </button>
          ))}
        </div>
        <MapControls layers={layers} onLayer={toggleLayer} grid={grid} onGrid={setGrid} />
      </header>

      <div className="border-line flex items-center gap-2 overflow-x-auto border-b px-3 py-1.5">
        <span className="text-micro text-ink-subtle shrink-0 font-mono tracking-widest uppercase">
          {t('epochs')}
        </span>
        <span className="text-meta shrink-0 font-mono font-semibold">
          {t('of26', { count: epochs.length })}
        </span>
        <div className="fc-epoch-wrap min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="fc-epoch-fade pointer-events-none absolute inset-y-0 left-0 z-10"
          />
          <div className="fc-epoch-scroll flex gap-1.5 overflow-x-auto" onScroll={handleScroll}>
            {epochs.map((epoch) => {
              const pressed = epoch.year === year;

              return (
                <button
                  key={epoch.year}
                  ref={pressed ? scrollSelected : undefined}
                  type="button"
                  aria-pressed={pressed}
                  value={epoch.year}
                  onClick={handleEpochClick}
                  className={`flex shrink-0 flex-col items-start rounded-md border px-2 py-1 text-left transition-colors ${
                    pressed
                      ? 'border-line-strong bg-seg text-ink'
                      : 'border-line text-ink-muted hover:bg-chip hover:text-ink'
                  }`}
                >
                  <span className="text-meta font-mono font-semibold">{epoch.year}</span>
                  <span className="text-micro text-ink-subtle max-tablet:hidden font-mono">
                    {formatEpochDays(epoch.date, locale)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Narrow windows stack the inspector and its state search above the map, where it is seen. */}
      <div className="max-wide:flex-col-reverse max-wide:flex-none flex min-h-0 flex-1">
      <div ref={mapArea} className="max-wide:min-h-96 relative min-h-0 flex-1">
        {mode === 'sat' ? (
          <NasaMap
            region={region}
            points={sat.dots}
            from={-Infinity}
            to={Infinity}
            ageLegend={false}
            imageryDate={epochs.find((epoch) => epoch.year === year)?.date}
            defaultBase="terra"
            dock="right"
            fill
            hex={{ on: layers.hex, maxRes: grid }}
            target={flyTo}
            selected={satSelected >= 0 ? satSelected : null}
            onHover={satHover}
            onPick={satPick}
          >
            {details === null && (
              <p className="bg-panel/90 text-micro text-ink-muted border-line absolute top-1/2 left-1/2 -translate-x-1/2 rounded-md border px-3 py-1.5 font-mono">
                {t('loadingDots')}
              </p>
            )}
          </NasaMap>
        ) : (
        <WorkbenchMap
          region={region}
          year={year}
          view={clamped}
          grid={grid}
          filters={filters}
          layers={layers}
          label={t('aria', { region: regionLabel, year })}
          onView={setView}
          onHover={setHover}
          selected={selected}
          onSelect={setSelected}
          highlight={highlight}
          details={details}
        />
        )}

        <div className="pointer-events-none absolute top-2 right-12 left-2 flex flex-wrap gap-1.5">
          {layers.power && details && (
            <span className="border-line bg-panel/90 text-micro text-ink-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono">
              {t('colourPower')}
              <span
                aria-hidden="true"
                className="h-1.5 w-14 rounded-full"
                style={{ background: POWER_GRADIENT }}
              />
              {t('powerRange')}
            </span>
          )}
          <span className="border-line bg-panel/90 text-micro text-ink-muted inline-flex items-center gap-2 rounded-md border px-2 py-1 font-mono">
            <span className="inline-flex items-center gap-1">
              <svg aria-hidden="true" width={8} height={8}>
                <circle cx={4} cy={4} r={3.5} fill="var(--ink-muted, currentColor)" />
              </svg>
              {t('viirs')}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg aria-hidden="true" width={8} height={8}>
                <circle cx={4} cy={4} r={3} fill="none" stroke="var(--text)" strokeWidth={1.4} />
              </svg>
              {t('modis')}
            </span>
          </span>
          <span className="border-line bg-panel/90 text-micro text-ink-muted rounded-md border px-2 py-1 font-mono">
            {t('sampled', { count: drawnCount })}
          </span>
          {layers.hex && (
            <span className="border-line bg-panel/90 text-micro text-ink-muted rounded-md border px-2 py-1 font-mono">
              {t('hexShown', { grid, resolution })}
            </span>
          )}
          <span className="border-line bg-panel/90 text-micro text-ink-muted max-tablet:hidden rounded-md border px-2 py-1 font-mono">
            {t('queryBox')} {data.queryBox.join(' · ')}
          </span>
          <span className="border-line bg-panel/90 text-micro text-ink-muted rounded-md border px-2 py-1 font-mono">
            {date}
          </span>
        </div>

        {mode === 'plane' && <MapZoom onZoom={zoom} onReset={handleReset} />}

        {mode === 'plane' && pxPerKm > 0 && <MapScale pxPerKm={pxPerKm} />}
        <MapGuide
          physics={physics}
          overlay={layers.overlay}
          epoch={epochs.find((epoch) => epoch.year === year)}
          filters={filters}
          onFilterAction={onFilter}
          onOverlayAction={handleOverlay}
          hex={layers.hex}
          grid={grid}
          resolution={resolution}
          saa={region === 'amazon'}
          islands={region === 'mekong'}
        />
        {mode === 'plane' && <MapFooter />}
        <MapTooltip hover={selected ? null : hover} container={mapArea} />
      </div>

      <aside
        aria-label={t('inspector.title')}
        className="border-line bg-surface wide:w-72 wide:border-l max-wide:border-b flex shrink-0 flex-col gap-2 overflow-y-auto p-2.5"
      >
        <MapSearch region={region} year={year} place={place} onPlace={handlePlace} />
        {selected ? (
          <MapDetailCard
            selected={selected}
            detail={details?.[selected.point.i] ?? null}
            loading={details === null}
            year={year}
            onClose={closeDetail}
          />
        ) : (
          !place && (
            <div className="border-line rounded-md border border-dashed p-3">
              <span className="text-meta block font-semibold">{t('inspector.heading')}</span>
              <p className="text-body text-ink-muted mt-1 leading-relaxed">{t('inspector.empty')}</p>
            </div>
          )
        )}
      </aside>
      </div>
    </section>
  );
}
