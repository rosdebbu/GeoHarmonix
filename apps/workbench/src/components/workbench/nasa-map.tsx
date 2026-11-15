'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { REGION_DEFS } from '@/lib/workbench/regions';
import type { RegionId } from '@/lib/calendar/types';
import type { GlobePoint } from './live-globe';

// A web-mercator map in the style of NASA Worldview / FIRMS: NASA GIBS satellite imagery under
// the fire detections, coloured by age. Written out here (no map library) so it adds no dependency.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const TILE = 256;
// `layer` is the same layer id NASA Worldview uses, so "Open in Worldview" lands on the same picture.
const BASES = {
  noaa20: { layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg', dated: true },
  noaa21: { layer: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg', dated: true },
  terra: { layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg', dated: true },
  aqua: { layer: 'MODIS_Aqua_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg', dated: true },
  blue: { layer: 'BlueMarble_ShadedRelief_Bathymetry', max: 8, ext: 'jpeg', dated: false },
} as const;
const COAST = { layer: 'Coastlines_15m', max: 13 } as const; // transparent PNG tiles
type BaseId = keyof typeof BASES;
const SATELLITE_NAME: Record<string, string> = { noaa20: 'NOAA-20', noaa21: 'NOAA-21', terra: 'Terra', aqua: 'Aqua' };

const rad = (deg: number) => (deg * Math.PI) / 180;
const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const p = rad(Math.max(-85, Math.min(85, lat)));
  return ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * TILE * 2 ** z;
};
const lonAt = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latAt = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (TILE * 2 ** z)))) * 180) / Math.PI;

/** FIRMS reading: newest fires red, then orange, then yellow. Colours are the design tokens. */
export const AGE_TOKENS = [
  { label: '0–24 h', token: '--raw', upTo: 24 },
  { label: '24–48 h', token: '--fire', upTo: 48 },
  { label: '48–72 h', token: '--amber', upTo: Infinity },
] as const;
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// NASA's daily imagery stops at about this level; zooming further only stretches it into a blur.
const MAX_ZOOM = 10;

type View = { lon: number; lat: number; z: number };

/** Uber H3 cell edge length in km (resolution 4-8), as lib/workbench/h3.ts. */
const HEX_EDGE_KM: Record<number, number> = { 4: 22.61, 5: 8.54, 6: 3.23, 7: 1.22, 8: 0.46 };

function cubeRound(q: number, r: number): [number, number] {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const [dx, dy, dz] = [Math.abs(rx - x), Math.abs(ry - y), Math.abs(rz - z)];
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

type Props = {
  region: RegionId;
  /** Frame this box [west, south, east, north] instead of the region's own. */
  bbox?: [number, number, number, number];
  /** Sorted by time, oldest first; the index passed to onHover is the position in this array. */
  points: GlobePoint[];
  from: number;
  to: number;
  onHover: (index: number | null, at?: { x: number; y: number }) => void;
  /** Called with the dot under a click, or null for a click on empty map. */
  onPick?: (index: number | null) => void;
  /** Index of the dot to ring. */
  selected?: number | null;
  /** Draw hexagon bins (H3-style) of the filled dots; `maxRes` caps how fine they get (4-8). */
  hex?: { on: boolean; maxRes: number };
  /** Fly here when `key` changes: a box [west, south, east, north] or a point and zoom. */
  target?: { key: string; box?: [number, number, number, number]; lon?: number; lat?: number; z?: number } | null;
  /** The age legend suits fire-age colouring only; hide it when the dots carry their own colours. */
  ageLegend?: boolean;
  /** Show imagery from this day (YYYY-MM-DD) instead of two days ago; for the recorded epochs. */
  imageryDate?: string | null;
  /** The imagery layer to start on. */
  defaultBase?: BaseId;
  /** Where the layer box and zoom buttons sit; 'right' leaves the left side to the host. */
  dock?: 'left' | 'right';
  /** Fill the parent box instead of the live panel's fixed height. */
  fill?: boolean;
  children?: ReactNode;
};

export function NasaMap({ region, bbox, points, from, to, onHover, onPick, selected = null, hex, target, ageLegend = true, imageryDate, defaultBase = 'noaa20', dock = 'left', fill = false, children }: Props) {
  const t = useTranslations('Map');
  const baseLabel = (id: BaseId) => (id === 'blue' ? t('blueMarble') : `${t('trueColour')} · ${SATELLITE_NAME[id]}`);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [base, setBase] = useState<BaseId>(defaultBase);
  const [coast, setCoast] = useState(true);
  const [view, setView] = useState<View>(() => ({ lon: REGION_DEFS[region].anchor[0], lat: REGION_DEFS[region].anchor[1], z: 5 }));
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const shown = useRef<{ x: number; y: number; index: number }[]>([]);
  const measured = useRef(false);
  const framed = useRef<string>('');

  // Imagery trails the clock: the latest daily mosaics are still being filled in, with black gaps.
  const clock = Number.isFinite(to) ? to : Date.now(); // the epoch map has no time window
  const trailing = useMemo(() => new Date(clock - 2 * 86_400_000).toISOString().slice(0, 10), [Math.floor(clock / 3_600_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = imageryDate && /^\d{4}-\d\d-\d\d$/.test(imageryDate) ? imageryDate : trailing;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      measured.current = true;
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Start framed on the region, once the real size is known.
  useEffect(() => {
    const key = `${region}/${bbox?.join(',') ?? ''}`;
    if (!measured.current || framed.current === key) return;
    framed.current = key;
    const [west, south, east, north] = bbox ?? REGION_DEFS[region].bbox;
    const spanX = worldX(east, 0) - worldX(west, 0);
    const spanY = worldY(south, 0) - worldY(north, 0);
    const z = Math.max(2, Math.min(9, Math.log2(Math.min(size.w / spanX, size.h / spanY)) - 0.15));
    setView({ lon: (west + east) / 2, lat: (south + north) / 2, z });
  }, [region, bbox, size]);

  // A new target (a searched place) flies the map there.
  const flown = useRef('');
  useEffect(() => {
    if (!target || !measured.current || flown.current === target.key) return;
    flown.current = target.key;
    if (target.box) {
      const [west, south, east, north] = target.box;
      const spanX = Math.max(worldX(east, 0) - worldX(west, 0), 1e-6);
      const spanY = Math.max(worldY(south, 0) - worldY(north, 0), 1e-6);
      const z = Math.max(2, Math.min(12, Math.log2(Math.min((size.w * 0.6) / spanX, (size.h * 0.6) / spanY))));
      setView({ lon: (west + east) / 2, lat: (south + north) / 2, z });
    } else if (target.lon !== undefined && target.lat !== undefined) {
      setView({ lon: target.lon, lat: target.lat, z: target.z ?? 8 });
    }
  }, [target, size]);

  const zoomTo = useCallback(
    (z2: number, at?: { x: number; y: number }) => {
      setView((v) => {
        const z = Math.max(2, Math.min(MAX_ZOOM, z2));
        const cursor = at ?? { x: size.w / 2, y: size.h / 2 };
        const lon = lonAt(worldX(v.lon, v.z) + (cursor.x - size.w / 2), v.z);
        const lat = latAt(worldY(v.lat, v.z) + (cursor.y - size.h / 2), v.z);
        return {
          z,
          lon: lonAt(worldX(lon, z) - (cursor.x - size.w / 2), z),
          lat: latAt(worldY(lat, z) - (cursor.y - size.h / 2), z),
        };
      });
    },
    [size],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const z = Math.max(2, Math.min(MAX_ZOOM, v.z - event.deltaY * 0.002));
        const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const lon = lonAt(worldX(v.lon, v.z) + (cursor.x - size.w / 2), v.z);
        const lat = latAt(worldY(v.lat, v.z) + (cursor.y - size.h / 2), v.z);
        return { z, lon: lonAt(worldX(lon, z) - (cursor.x - size.w / 2), z), lat: latAt(worldY(lat, z) - (cursor.y - size.h / 2), z) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  // Tiles: the layer's own zoom level nearest the view, stretched to the exact view zoom.
  const tiles = useMemo(() => {
    const layers: { key: string; src: string; x: number; y: number; s: number }[] = [];
    const add = (id: string, path: string, ext: string, max: number) => {
      const zt = Math.max(1, Math.min(max, Math.floor(view.z)));
      const s = 2 ** (view.z - zt);
      const cx = worldX(view.lon, zt);
      const cy = worldY(view.lat, zt);
      const n = 2 ** zt;
      const x0 = Math.floor((cx - size.w / 2 / s) / TILE);
      const x1 = Math.floor((cx + size.w / 2 / s) / TILE);
      const y0 = Math.floor((cy - size.h / 2 / s) / TILE);
      const y1 = Math.floor((cy + size.h / 2 / s) / TILE);
      for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
          layers.push({
            key: `${id}/${zt}/${tx}/${ty}`,
            src: `${GIBS}/${path}/${zt}/${ty}/${((tx % n) + n) % n}.${ext}`,
            x: size.w / 2 + (tx * TILE - cx) * s,
            y: size.h / 2 + (ty * TILE - cy) * s,
            s,
          });
        }
      }
    };
    const b = BASES[base];
    add(`b-${base}-${date}`, `${b.layer}/default/${b.dated ? `${date}/` : ''}GoogleMapsCompatible_Level${b.max}`, b.ext, b.max);
    if (coast) add('coast', `${COAST.layer}/default/GoogleMapsCompatible_Level${COAST.max}`, 'png', COAST.max);
    return layers;
  }, [view, size, base, coast, date]);

  // Fire detections, drawn on a canvas over the tiles.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = size.w * ratio;
    element.height = size.h * ratio;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    const colors = AGE_TOKENS.map((age) => token(age.token));
    const outline = token('--bg');
    const cx = worldX(view.lon, view.z);
    const cy = worldY(view.lat, view.z);
    const radius = Math.max(1.6, Math.min(8, 1.2 + (view.z - 2) * 0.8)); // small when zoomed out, so thousands of dots stay readable
    const hits: typeof shown.current = [];
    if (hex?.on) {
      // Hexagon bins on a fixed world grid, so they hold still while you pan.
      const mpp = (40_075_016.686 * Math.cos(rad(view.lat))) / (TILE * 2 ** view.z); // metres per pixel
      const res = view.z < 6 ? 4 : view.z < 8 ? 5 : view.z < 10 ? 6 : view.z < 12 ? 7 : 8;
      const edge = (HEX_EDGE_KM[Math.min(res, hex.maxRes)] ?? 1.22) * 1000 / mpp;
      const root3 = Math.sqrt(3);
      const bins = new Map<string, number>();
      points.forEach((p) => {
        if (p.ring || p.ms < from || p.ms > to) return;
        const wx = worldX(p.lon, view.z);
        const wy = worldY(p.lat, view.z);
        const q = ((root3 / 3) * wx - wy / 3) / edge;
        const r = ((2 / 3) * wy) / edge;
        const [a, b] = cubeRound(q, r);
        bins.set(`${a},${b}`, (bins.get(`${a},${b}`) ?? 0) + 1);
      });
      const most = Math.max(1, ...bins.values());
      const fill = token('--amber');
      for (const [key, count] of bins) {
        const [a, b] = key.split(',').map(Number) as [number, number];
        const x = size.w / 2 + edge * root3 * (a + b / 2) - cx;
        const y = size.h / 2 + edge * 1.5 * b - cy;
        if (x < -edge * 2 || y < -edge * 2 || x > size.w + edge * 2 || y > size.h + edge * 2) continue;
        context.beginPath();
        for (let k = 0; k < 6; k += 1) {
          const angle = rad(30 + 60 * k);
          context[k === 0 ? 'moveTo' : 'lineTo'](x + edge * Math.cos(angle), y + edge * Math.sin(angle));
        }
        context.closePath();
        context.globalAlpha = 0.18 + 0.62 * (count / most);
        context.fillStyle = fill;
        context.fill();
        context.globalAlpha = 0.9;
        context.lineWidth = 0.8;
        context.strokeStyle = outline;
        context.stroke();
        context.globalAlpha = 1;
      }
    }
    points.forEach((p, index) => {
      if (p.ms < from || p.ms > to) return;
      const x = size.w / 2 + worldX(p.lon, view.z) - cx;
      const y = size.h / 2 + worldY(p.lat, view.z) - cy;
      if (x < -10 || y < -10 || x > size.w + 10 || y > size.h + 10) return;
      if (hex?.on && !p.ring) {
        hits.push({ x, y, index }); // stays hoverable and pickable under the hexagons
        return;
      }
      const hours = (to - p.ms) / 3_600_000;
      context.beginPath();
      context.arc(x, y, p.ring ? radius + 1 : radius, 0, Math.PI * 2);
      if (p.ring) {
        context.lineWidth = 1.2;
        context.strokeStyle = p.color ?? token('--grey');
        context.globalAlpha = 0.9;
        context.stroke();
        context.globalAlpha = 1;
      } else {
        context.fillStyle = p.color ?? colors[AGE_TOKENS.findIndex((age) => hours <= age.upTo)]!;
        context.globalAlpha = 0.9;
        context.fill();
        context.globalAlpha = 1;
        context.lineWidth = 0.8;
        context.strokeStyle = outline;
        context.stroke();
      }
      if (index === selected) {
        context.beginPath();
        context.arc(x, y, radius + 6, 0, Math.PI * 2);
        context.lineWidth = 2;
        context.strokeStyle = token('--text');
        context.stroke();
      }
      hits.push({ x, y, index });
    });
    shown.current = hits;
  }, [points, from, to, view, size, hex, selected]);

  const onPointerDown = (event: React.PointerEvent) => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    if (drag.current) {
      const [dx, dy] = [event.clientX - drag.current.x, event.clientY - drag.current.y];
      drag.current = { x: event.clientX, y: event.clientY, moved: drag.current.moved || Math.hypot(dx, dy) > 2 };
      setView((v) => ({ ...v, lon: lonAt(worldX(v.lon, v.z) - dx, v.z), lat: latAt(worldY(v.lat, v.z) - dy, v.z) }));
      onHover(null);
      return;
    }
    const [mx, my] = [event.clientX - rect.left, event.clientY - rect.top];
    let best: { index: number; d: number } | null = null;
    for (const h of shown.current) {
      const d = Math.hypot(h.x - mx, h.y - my);
      if (d < 10 && (!best || d < best.d)) best = { index: h.index, d };
    }
    onHover(best ? best.index : null, { x: mx, y: my });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const wasClick = drag.current && !drag.current.moved;
    drag.current = null;
    if (!wasClick || !onPick) return;
    const rect = box.current!.getBoundingClientRect();
    const [mx, my] = [event.clientX - rect.left, event.clientY - rect.top];
    let best: { index: number; d: number } | null = null;
    for (const h of shown.current) {
      const d = Math.hypot(h.x - mx, h.y - my);
      if (d < 12 && (!best || d <= best.d)) best = { index: h.index, d };
    }
    onPick(best ? best.index : null);
  };

  // The same picture on NASA Worldview: the box on screen, the chosen layer, the same day.
  const worldview = useMemo(() => {
    const [cx, cy] = [worldX(view.lon, view.z), worldY(view.lat, view.z)];
    const v = [lonAt(cx - size.w / 2, view.z), latAt(cy + size.h / 2, view.z), lonAt(cx + size.w / 2, view.z), latAt(cy - size.h / 2, view.z)];
    const layers = [coast ? COAST.layer : null, BASES[base].layer].filter(Boolean).join(',');
    return `https://worldview.earthdata.nasa.gov/?v=${v.map((n) => n.toFixed(2)).join(',')}&l=${layers}&t=${date}-T00%3A00%3A00Z`;
  }, [view, size, base, coast, date]);

  const overlay = 'bg-panel/90 text-ink border-line border backdrop-blur-sm';

  return (
    <div
      ref={box}
      className={`${fill ? 'absolute inset-0' : 'fc-live-view relative w-full'} border-line bg-canvas touch-none overflow-hidden rounded-md border select-none`}
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={(event) => {
        const rect = box.current!.getBoundingClientRect();
        zoomTo(view.z + 1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
    >
      {tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-0 left-0 max-w-none"
          style={{ width: TILE, height: TILE, transformOrigin: '0 0', transform: `translate(${tile.x}px, ${tile.y}px) scale(${tile.s})` }}
        />
      ))}
      <canvas ref={canvas} className="pointer-events-none absolute inset-0" style={{ width: size.w, height: size.h }} />

      <div className={`${overlay} text-micro absolute flex flex-col gap-1 rounded-md p-2 font-mono ${dock === 'right' ? 'top-24 right-2' : 'top-2 left-2'}`} onPointerDown={(event) => event.stopPropagation()}>
        {(Object.keys(BASES) as BaseId[]).map((id) => (
          <label key={id} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="nasa-base" checked={base === id} onChange={() => setBase(id)} />
            {baseLabel(id)}
          </label>
        ))}
        <hr className="border-line" />
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={coast} onChange={() => setCoast((on) => !on)} />
          {t('coastlines')}
        </label>
        {BASES[base].dated && <p className="text-ink-subtle max-w-40 leading-snug">{t('gapHint')}</p>}
        <a href={worldview} target="_blank" rel="noopener noreferrer" className="text-brand mt-0.5 underline">
          {t('openWorldview')} ↗
        </a>
      </div>

      <div className={`${overlay} absolute flex flex-col overflow-hidden rounded-md ${dock === 'right' ? 'top-2 right-2' : 'bottom-8 left-2'}`} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label={t('zoomIn')} className="hover:bg-chip size-8" onClick={() => zoomTo(view.z + 1)}>
          +
        </button>
        <button type="button" aria-label={t('zoomOut')} className="border-line hover:bg-chip size-8 border-t" onClick={() => zoomTo(view.z - 1)}>
          −
        </button>
      </div>

      {ageLegend && (
      <div className={`${overlay} text-micro pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md px-2.5 py-1 font-mono`}>
        {AGE_TOKENS.map((age) => (
          <span key={age.token} className="flex items-center gap-1">
            <span className="border-line size-2.5 rounded-full border" style={{ background: `var(${age.token})` }} />
            {age.label}
          </span>
        ))}
      </div>
      )}

      <p className="bg-panel/90 text-micro text-ink-muted pointer-events-none absolute right-0 bottom-0 left-0 truncate px-2 py-0.5 font-mono">
        {t('imagery')} · {baseLabel(base)}
        {BASES[base].dated ? ` · ${date}` : ''} · {t('dragHint')}
      </p>
      {children}
    </div>
  );
}
