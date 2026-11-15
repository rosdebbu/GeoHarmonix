'use client';

import { useState } from 'react';
import { SectionHeading } from '@/components/ui/section-heading';
import { useLocale, useTranslations } from 'next-intl';
import { axis } from '@/lib/workbench/chart';
import type { Calibration, MapPhysics, SensorLabData } from '@/lib/workbench/types';

const W = 420;
const H = 200;
const LEFT = 40;
const TOP = 10;
const BOTTOM = 22;
const PLOT_H = H - TOP - BOTTOM;
const PLOT_W = W - LEFT - 12;
const GRID = { stroke: 'var(--line-strong)', strokeDasharray: '3 3', strokeWidth: 1 } as const;
const TICK = { fontSize: 11, fill: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' } as const;
const panel = 'border-line bg-panel rounded-lg border p-3';
const readout = 'text-meta text-ink border-line bg-chip mt-1 min-h-8 rounded-md border px-2 py-1.5 font-mono';

/** How the two sensor families differ, and what harmonization changes, from this project's own measurements. */
export function SensorLab({
  year,
  onYear,
  lab,
  calibration,
  physics,
  regionLabel,
}: {
  year: number;
  onYear: (year: number) => void;
  lab: SensorLabData;
  calibration: Calibration;
  physics: MapPhysics;
  regionLabel: string;
}) {
  const t = useTranslations('Lab');
  const locale = useLocale();
  const number = (n: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);

  const [pickYear, setPickYear] = useState<number | null>(null);
  const [pickBar, setPickBar] = useState<string | null>(null);
  const [pickHeld, setPickHeld] = useState<string | null>(null);
  const rows = lab.epochs;
  const row = rows.find((r) => r.year === year);

  // A: raw detections per sensor family across the measured years
  const yMax = axis(Math.max(...rows.map((r) => Math.max(r.modis, r.viirs)), 1));
  const lx = (i: number) => LEFT + (rows.length > 1 ? (i / (rows.length - 1)) * PLOT_W : PLOT_W / 2);
  const ly = (v: number) => TOP + PLOT_H - (v / yMax.top) * PLOT_H;
  const selected = rows.findIndex((r) => r.year === year);
  const pickIndex = rows.findIndex((r) => r.year === pickYear);
  const picked = pickIndex >= 0 ? rows[pickIndex]! : null;
  const viirsPoints = rows.flatMap((r, i) => (r.viirs > 0 ? [{ r, i }] : []));

  // B: agreement between sensors on coincident overpasses
  const groups = [
    { label: t('agreeR2'), bars: [[calibration.r2Raw, 'var(--raw)', t('raw')], [calibration.r2Harmonized, 'var(--teal)', t('harmonized')]] as const },
    { label: t('agreeKs'), bars: [[calibration.ksBefore, 'var(--raw)', t('before')], [calibration.ksAfter, 'var(--teal)', t('after')]] as const },
  ];
  const gw = PLOT_W / groups.length;

  // C: held-out years of the omission-factor fit
  const heldYears = lab.omission ? Object.keys(lab.omission.before).sort() : [];
  const heldMax = axis(Math.max(...heldYears.map((y) => lab.omission!.before[y] ?? 0), 1.2));
  const hy = (v: number) => TOP + PLOT_H - (v / heldMax.top) * PLOT_H;
  const hw = PLOT_W / Math.max(heldYears.length, 1);

  const crosses = calibration.holdout.ciLowMw <= 0 && calibration.holdout.ciHighMw >= 0;
  const cards: [string, string, string][] = [
    [t('kpiModis', { year }), row ? number(row.modis) : '—', t('kpiWindow')],
    [t('kpiViirs', { year }), row && row.viirs > 0 ? number(row.viirs) : '—', row && row.viirs > 0 ? t('kpiWindow') : t('kpiNoViirs')],
    [t('kpiRatio'), row && row.viirs > 0 && row.modis > 0 ? `${number(row.viirs / row.modis, 1)}×` : '—', t('kpiRatioSub')],
    [t('kpiPixel'), `${number(physics.ratio, 0)}×`, t('kpiPixelSub', { edge: number(physics.modisEdge, 2), nadir: number(physics.viirsNadir, 2) })],
    [t('kpiSza'), row ? `${number(row.szaPct, 1)}%` : '—', t('kpiSzaSub')],
    [t('kpiSaa'), row ? number(row.saa) : '—', t('kpiSaaSub')],
  ];

  return (
    <section aria-labelledby="lab-title" className="mt-6" data-testid="sensor-lab">
      <header className="mb-3">
        <SectionHeading id="lab-title" icon="∿" title={t('title')} subtitle={t('subtitle', { region: regionLabel })} />
      </header>

      <label className="mb-2 flex items-center gap-2">
        <span className="text-meta text-ink-subtle font-mono tracking-widest uppercase">{t('year')}</span>
        <select value={year} onChange={(event) => onYear(Number(event.target.value))} className="border-line-strong bg-canvas text-meta text-ink rounded-md border px-2 py-1">
          {rows
            .map((r) => r.year)
            .reverse()
            .map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
        </select>
      </label>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value, sub]) => (
          <div key={label} className={panel}>
            <dt className="text-meta text-ink-subtle font-mono tracking-widest uppercase">{label}</dt>
            <dd className="text-title font-mono font-semibold tabular-nums">{value}</dd>
            <p className="text-meta text-ink-subtle leading-snug">{sub}</p>
          </div>
        ))}
      </dl>

      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {/* A: divergence over the years */}
        <div className={panel}>
          <h3 className="text-body font-semibold">{t('divTitle')}</h3>
          <p className="text-meta text-ink-subtle">{t('divSub')}</p>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('divTitle')} className="mx-auto mt-2 w-full max-w-md">
            {yMax.ticks.map((tick) => (
              <g key={tick}>
                <line x1={LEFT} x2={W - 12} y1={ly(tick)} y2={ly(tick)} {...GRID} />
                <text x={LEFT - 6} y={ly(tick) + 3} textAnchor="end" {...TICK}>
                  {number(tick)}
                </text>
              </g>
            ))}
            <polyline points={rows.map((r, i) => `${lx(i)},${ly(r.modis)}`).join(' ')} fill="none" stroke="var(--amber)" strokeWidth={2.5} strokeLinejoin="round" />
            <polyline points={viirsPoints.map(({ r, i }) => `${lx(i)},${ly(r.viirs)}`).join(' ')} fill="none" stroke="var(--cyan)" strokeWidth={2.5} strokeLinejoin="round" />
            {rows.map((r, i) => (
              <g key={r.year}>
                {r.year === year && <line x1={lx(i)} x2={lx(i)} y1={TOP} y2={TOP + PLOT_H} stroke="var(--text-subtle)" strokeWidth={1} />}
                <circle cx={lx(i)} cy={ly(r.modis)} r={r.year === year ? 4.5 : 2.5} fill="var(--amber)" />
                {r.viirs > 0 && <circle cx={lx(i)} cy={ly(r.viirs)} r={r.year === year ? 4.5 : 2.5} fill="var(--cyan)" />}
                {i % 4 === 0 && (
                  <text x={lx(i)} y={H - 8} textAnchor="middle" {...TICK}>
                    {r.year}
                  </text>
                )}
              </g>
            ))}
            <line x1={LEFT} x2={W - 12} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="var(--text-subtle)" strokeWidth={1} />
            {pickIndex >= 0 && (
              <>
                <line x1={lx(pickIndex)} x2={lx(pickIndex)} y1={TOP} y2={TOP + PLOT_H} stroke="var(--text)" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={lx(pickIndex)} cy={ly(rows[pickIndex]!.modis)} r={5} fill="var(--amber)" stroke="var(--text)" strokeWidth={1.5} />
                {rows[pickIndex]!.viirs > 0 && <circle cx={lx(pickIndex)} cy={ly(rows[pickIndex]!.viirs)} r={5} fill="var(--cyan)" stroke="var(--text)" strokeWidth={1.5} />}
              </>
            )}
            <rect
              x={LEFT}
              y={TOP}
              width={PLOT_W}
              height={PLOT_H}
              fill="transparent"
              className="cursor-pointer"
              onClick={(event) => {
                const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                const x = ((event.clientX - box.left) / box.width) * W;
                const i = Math.round(((x - LEFT) / PLOT_W) * (rows.length - 1));
                setPickYear(rows[Math.min(Math.max(i, 0), rows.length - 1)]!.year);
              }}
            />
            {selected >= 0 && row && (
              <>
                <text x={lx(selected) - 7} y={ly(row.modis) - 8} textAnchor="end" {...TICK} fill="var(--amber)">
                  {number(row.modis)}
                </text>
                {row.viirs > 0 && (
                  <text x={lx(selected) - 7} y={ly(row.viirs) - 8} textAnchor="end" {...TICK} fill="var(--cyan)">
                    {number(row.viirs)}
                  </text>
                )}
              </>
            )}
          </svg>
          <p className="text-meta mt-1 flex flex-wrap gap-x-3 font-mono">
            <span className="text-amber">■ MODIS {row ? number(row.modis) : ''}</span>
            <span className="text-cyan">■ VIIRS {row && row.viirs > 0 ? number(row.viirs) : '—'}</span>
            <span className="text-ink-subtle">{row?.year}</span>
          </p>
          <p className={readout} aria-live="polite">
            {picked ? t('divPick', { year: picked.year, modis: number(picked.modis), viirs: picked.viirs > 0 ? number(picked.viirs) : '—', ratio: picked.viirs > 0 && picked.modis > 0 ? `${number(picked.viirs / picked.modis, 1)}×` : '—' }) : t('pickHint')}
          </p>
          <p className="text-meta text-ink-subtle mt-1">{t('divNote')}</p>
        </div>

        {/* B: agreement on coincident overpasses */}
        <div className={panel}>
          <h3 className="text-body font-semibold">{t('agreeTitle')}</h3>
          <p className="text-meta text-ink-subtle">{t('agreeSub', { pairs: number(calibration.pairs) })}</p>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('agreeTitle')} className="mx-auto mt-2 w-full max-w-md">
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
              <g key={tick}>
                <line x1={LEFT} x2={W - 12} y1={TOP + PLOT_H - tick * PLOT_H} y2={TOP + PLOT_H - tick * PLOT_H} {...GRID} />
                <text x={LEFT - 6} y={TOP + PLOT_H - tick * PLOT_H + 3} textAnchor="end" {...TICK}>
                  {tick}
                </text>
              </g>
            ))}
            {groups.map((group, g) =>
              group.bars.map(([value, color, label], b) => {
                const x = LEFT + g * gw + gw * 0.18 + b * gw * 0.34;
                const h = Math.max(value * PLOT_H, 1);
                return (
                  <g key={`${g}-${b}`}>
                    <rect x={x} y={TOP + PLOT_H - h} width={gw * 0.3} height={h} rx={3} fill={color} className="cursor-pointer" stroke={pickBar === `${g}-${b}` ? 'var(--text)' : 'none'} strokeWidth={2} onClick={() => setPickBar(`${g}-${b}`)} />
                    <text x={x + gw * 0.15} y={TOP + PLOT_H - h - 4} textAnchor="middle" {...TICK} fill="var(--text)">
                      {number(value, 3)}
                    </text>
                    <text x={x + gw * 0.15} y={H - 8} textAnchor="middle" {...TICK}>
                      {label}
                    </text>
                  </g>
                );
              }),
            )}
            {groups.map((group, g) => (
              <text key={group.label} x={LEFT + g * gw + gw / 2} y={TOP + 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {group.label}
              </text>
            ))}
            <line x1={LEFT} x2={W - 12} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="var(--text-subtle)" strokeWidth={1} />
          </svg>
          <p className={readout} aria-live="polite">
            {pickBar ? `${groups[Number(pickBar[0])]!.bars[Number(pickBar[2])]![2]} · ${groups[Number(pickBar[0])]!.label}: ${number(groups[Number(pickBar[0])]!.bars[Number(pickBar[2])]![0], 4)}` : t('pickHint')}
          </p>
          <p className="text-meta text-ink-subtle mt-1">{t('agreeNote', { before: number(calibration.rmseRaw, 1), after: number(calibration.rmseHarmonized, 1) })}</p>
        </div>

        {/* C: held-out years */}
        <div className={`${panel} md:col-span-2 xl:col-span-1`}>
          <h3 className="text-body font-semibold">{t('heldTitle')}</h3>
          <p className="text-meta text-ink-subtle">
            {lab.omission ? t('heldSub', { from: Math.min(...lab.omission.trainYears), to: Math.max(...lab.omission.trainYears), k: number(lab.omission.kFit, 1) }) : t('heldNone')}
          </p>
          {lab.omission && (
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('heldTitle')} className="mx-auto mt-2 w-full max-w-md">
              {heldMax.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={LEFT} x2={W - 12} y1={hy(tick)} y2={hy(tick)} {...GRID} />
                  <text x={LEFT - 6} y={hy(tick) + 3} textAnchor="end" {...TICK}>
                    {number(tick, 1)}
                  </text>
                </g>
              ))}
              <line x1={LEFT} x2={W - 12} y1={hy(1)} y2={hy(1)} stroke="var(--ok)" strokeWidth={1.5} strokeDasharray="5 3" />
              {heldYears.map((y, i) => {
                const before = lab.omission!.before[y] ?? 0;
                const after = lab.omission!.after[y] ?? 0;
                const x = LEFT + i * hw + hw * 0.12;
                return (
                  <g key={y}>
                    <rect x={x} y={hy(before)} width={hw * 0.36} height={Math.max(TOP + PLOT_H - hy(before), 1)} rx={3} fill="var(--raw)" className="cursor-pointer" stroke={pickHeld === y ? 'var(--text)' : 'none'} strokeWidth={2} onClick={() => setPickHeld(y)} />
                    <rect x={x + hw * 0.4} y={hy(after)} width={hw * 0.36} height={Math.max(TOP + PLOT_H - hy(after), 1)} rx={3} fill="var(--teal)" className="cursor-pointer" stroke={pickHeld === y ? 'var(--text)' : 'none'} strokeWidth={2} onClick={() => setPickHeld(y)} />
                    <text x={x + hw * 0.18} y={hy(before) - 4} textAnchor="middle" fontSize={10} fill="var(--text)" fontFamily="var(--font-mono)">
                      {number(before, 1)}
                    </text>
                    <text x={x + hw * 0.58} y={hy(after) - 4} textAnchor="middle" fontSize={10} fill="var(--text)" fontFamily="var(--font-mono)">
                      {number(after, 1)}
                    </text>
                    <text x={x + hw * 0.38} y={H - 8} textAnchor="middle" {...TICK}>
                      {y}
                    </text>
                  </g>
                );
              })}
              <line x1={LEFT} x2={W - 12} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="var(--text-subtle)" strokeWidth={1} />
            </svg>
          )}
          <p className="text-meta mt-1 flex flex-wrap gap-x-3 font-mono">
            <span className="text-raw">■ {t('before')}</span>
            <span className="text-teal">■ {t('after')}</span>
            <span className="text-ok">╌ {t('agreement')}</span>
          </p>
          {lab.omission && (
            <p className={readout} aria-live="polite">
              {pickHeld ? t('heldPick', { year: pickHeld, before: number(lab.omission.before[pickHeld] ?? 0, 2), after: number(lab.omission.after[pickHeld] ?? 0, 2) }) : t('pickHint')}
            </p>
          )}
          <p className="text-meta text-ink-subtle mt-1">{t('heldNote')}</p>
        </div>
      </div>

      <div className={`${panel} mt-2`}>
        <h3 className="text-meta text-warn font-semibold">⚠ {t('cautionTitle')}</h3>
        <p className="text-meta text-ink-muted mt-1">
          {t('frp', {
            year: calibration.holdout.trainLastYear,
            gain: number(calibration.holdout.gainMw, 2),
            low: number(calibration.holdout.ciLowMw, 1),
            high: number(calibration.holdout.ciHighMw, 1),
          })}{' '}
          {crosses ? t('frpNoGain') : t('frpGain')}
        </p>
        <p className="text-meta text-ink-subtle mt-1 max-w-4xl">{t('caution')}</p>
      </div>
    </section>
  );
}
