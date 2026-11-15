'use client';

import { useEffect, useMemo, useState } from 'react';
import { SectionHeading } from '@/components/ui/section-heading';
import { useLocale, useTranslations } from 'next-intl';
import { axis } from '@/lib/workbench/chart';
import { loadPlaces, statsFor, type MapPlace } from '@/lib/workbench/map-search';
import type { CalendarRegionData, HfdUnit, RegionId } from '@/lib/calendar/types';

type Metric = 'activity' | 'anomaly';
const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

/** The month (0-11) a five-day pentad mostly falls in. */
const monthOfPentad = (pentad: number) => CUMULATIVE_DAYS.findIndex((start, i) => i < 12 && 5 * pentad + 2 < CUMULATIVE_DAYS[i + 1]!);

const GRID = { stroke: 'var(--line-strong)', strokeDasharray: '3 3', strokeWidth: 1 } as const;
const TICK = { fontSize: 11, fill: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' } as const;

/** State-by-state fire intelligence: pick a country, state and year; read the numbers; click the charts. */
export function RegionalIntelligence({
  region,
  year,
  onYear,
  calendar,
  unit,
  regionLabel,
}: {
  region: RegionId;
  year: number;
  onYear: (year: number) => void;
  calendar: CalendarRegionData;
  unit: HfdUnit;
  regionLabel: string;
}) {
  const t = useTranslations('Intel');
  const locale = useLocale();
  const number = (n: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  const [places, setPlaces] = useState<MapPlace[] | null>(null);
  const [placeId, setPlaceId] = useState('');
  const [countryName, setCountryName] = useState('');
  const [metric, setMetric] = useState<Metric>('activity');

  useEffect(() => {
    let live = true;
    setPlaces(null);
    setPlaceId('');
    setCountryName('');
    void loadPlaces(region).then((rows) => live && setPlaces(rows));
    return () => {
      live = false;
    };
  }, [region]);

  const counted = (place: MapPlace, y: number) => statsFor(place, y)[1];
  const countries = useMemo(() => (places ?? []).filter((p) => p.kind === 'country'), [places]);
  const states = useMemo(() => (places ?? []).filter((p) => p.kind === 'state'), [places]);
  const pool = countryName ? states.filter((s) => s.parent === countryName) : states;
  // Until someone picks a place, show the busiest state of the chosen year.
  const place = useMemo(() => {
    const picked = (places ?? []).find((p) => p.id === placeId);
    if (picked) return picked;
    return [...pool].sort((a, b) => counted(b, year) - counted(a, year))[0] ?? null;
  }, [places, placeId, pool, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo(
    () =>
      Object.keys(place?.s ?? {})
        .map(Number)
        .sort((a, b) => a - b)
        .map((y) => ({ year: y, count: place!.s[String(y)]![1], sampled: place!.s[String(y)]![0] })),
    [place],
  );
  const country = place?.kind === 'state' ? countries.find((c) => c.name === place.parent) : place;
  const peers = useMemo(
    () =>
      (place?.kind === 'state' ? states.filter((s) => s.parent === place.parent) : pool)
        .map((s) => ({ place: s, count: counted(s, year) }))
        .sort((a, b) => b.count - a.count),
    [place, states, pool, year], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rank = place ? peers.findIndex((row) => row.place.id === place.id) + 1 : 0;
  const here = place ? statsFor(place, year) : [0, 0];
  const countryCount = country ? counted(country, year) : 0;
  const share = countryCount > 0 ? Math.round((here[1] / countryCount) * 100) : 0;
  const readRow = series.find((row) => row.year === year);

  // ---- Monthly analysis: the region's calendar, grouped into months ----------------------------
  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m, 15)))),
    [locale],
  );
  const monthly = useMemo(() => {
    const byMonth = (row: number[]) => {
      const sums = new Array<number>(12).fill(0);
      const n = new Array<number>(12).fill(0);
      row.forEach((value, pentad) => {
        const m = monthOfPentad(pentad);
        if (m >= 0 && Number.isFinite(value)) {
          sums[m]! += value;
          n[m]! += 1;
        }
      });
      return sums.map((sum, m) => (n[m]! ? sum / n[m]! : 0));
    };
    const rows = calendar.years.map((y, i) => ({ year: y, i, months: byMonth(calendar.hfd[i] ?? []) })).filter((r) => calendar.provenance[r.i]!.some((p) => p < 2));
    const average = Array.from({ length: 12 }, (_, m) => rows.reduce((sum, r) => sum + r.months[m]!, 0) / Math.max(rows.length, 1));
    const picked = rows.find((r) => r.year === year)?.months ?? new Array<number>(12).fill(0);
    return { activity: picked, anomaly: picked.map((v, m) => (average[m]! > 0 ? ((v - average[m]!) / average[m]!) * 100 : 0)) };
  }, [calendar, year]);

  const unitLabel = unit === 'density' ? t('unitDensity') : t('unitDetections');
  const panel = 'border-line bg-panel rounded-lg border p-3';
  const pill = (on: boolean) => `text-meta h-6 rounded-md px-2.5 font-semibold ${on ? 'bg-amber text-canvas' : 'text-ink-muted hover:text-ink'}`;

  // ---- chart geometry ----------------------------------------------------------------------------
  const W = 420;
  const H = 200;
  const left = 38;
  const top = 10;
  const bottom = 22;
  const plotH = H - top - bottom;
  const plotW = W - left - 12;

  const monthValues = monthly[metric];
  const monthAxis = axis(Math.max(...monthly.activity, 1e-9));
  const sigmaMax = Math.max(50, Math.ceil(Math.max(...monthly.anomaly.map(Math.abs)) / 50) * 50);
  const monthZero = metric === 'activity' ? top + plotH : top + plotH / 2;
  const monthY = (v: number) => (metric === 'activity' ? top + plotH - (v / monthAxis.top) * plotH : monthZero - (v / sigmaMax) * (plotH / 2));
  const bw = plotW / 12;

  const maxCount = Math.max(...series.map((r) => r.count), 1);
  const annual = axis(maxCount);
  const lineX = (i: number) => left + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
  const lineY = (v: number) => top + plotH - (v / annual.top) * plotH;

  const top10 = peers.slice(0, 10);
  const barAxis = axis(Math.max(...top10.map((r) => r.count), 1));
  const rowH = 19;
  const barsLeft = 92;
  const barsW = W - barsLeft - 44;
  const barsH = top10.length * rowH + 22;

  return (
    <section aria-labelledby="intel-title" className="mt-6" data-testid="regional-intelligence">
      <header className="mb-3">
        <SectionHeading id="intel-title" icon="▤" title={t('title')} subtitle={t('subtitle')} />
      </header>

      <div className={`${panel} grid gap-2 sm:grid-cols-3`}>
        {[
          [t('country'), countryName, (v: string) => { setCountryName(v); setPlaceId(''); }, [['', t('allCountries')], ...countries.map((c) => [c.name, c.name] as [string, string])]],
          [t('place'), place?.id ?? '', (v: string) => setPlaceId(v), pool.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => [s.id, s.name] as [string, string])],
          [t('year'), String(year), (v: string) => onYear(Number(v)), (series.length ? series.map((r) => r.year) : [year]).slice().reverse().map((y) => [String(y), String(y)] as [string, string])],
        ].map(([label, value, onChange, options]) => (
          <label key={label as string} className="flex flex-col gap-1">
            <span className="text-meta text-ink-subtle font-mono tracking-widest uppercase">{label as string}</span>
            <select
              value={value as string}
              onChange={(event) => (onChange as (v: string) => void)(event.target.value)}
              disabled={!places}
              className="border-line-strong bg-canvas text-meta text-ink rounded-md border px-2 py-1"
            >
              {(options as [string, string][]).map(([v, name]) => (
                <option key={v} value={v}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {!place ? (
        <p className="text-meta text-ink-subtle mt-3">{places ? t('noData') : t('loading')}</p>
      ) : (
        <>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              [t('kpiCounted', { year }), number(here[1]), t('kpiSampled', { count: number(here[0]) })],
              [t('kpiRank', { country: country?.name ?? place.parent }), place.kind === 'state' && here[0] > 0 ? `#${rank} / ${peers.length}` : '—', place.kind === 'state' && here[0] > 0 ? t('kpiShare', { share, country: country?.name ?? place.parent }) : t('noData')],
              [t('kpiYears'), t('kpiYearsValue', { count: series.filter((r) => r.count > 0).length, total: series.length }), series.length ? `${series[0]!.year}–${series.at(-1)!.year}` : ''],
            ].map(([label, value, sub]) => (
              <div key={label} className={panel}>
                <dt className="text-meta text-ink-subtle font-mono tracking-widest uppercase">{label}</dt>
                <dd className="text-title font-mono font-semibold tabular-nums">{value}</dd>
                <p className="text-meta text-ink-subtle mt-0.5">{sub}</p>
              </div>
            ))}
          </dl>

          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {/* Monthly regional analysis */}
          <div className={panel}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-body flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className="text-amber">↗</span>
                  {t('monthlyTitle')}
                </h3>
                <p className="text-meta text-ink-subtle">{t('monthlySub', { region: regionLabel, year })}</p>
              </div>
              <div role="group" aria-label={t('metric')} className="border-line-strong inline-flex gap-1 rounded-lg border p-0.5">
                {(['activity', 'anomaly'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={pill(metric === value)}>
                    {t(value)}
                  </button>
                ))}
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('monthlyTitle')} className="mx-auto mt-2 w-full max-w-md">
              {(metric === 'activity' ? monthAxis.ticks : [-sigmaMax, -sigmaMax / 2, 0, sigmaMax / 2, sigmaMax]).map((tick) => (
                <g key={tick}>
                  <line x1={left} x2={W - 12} y1={monthY(tick)} y2={monthY(tick)} {...GRID} />
                  <text x={left - 6} y={monthY(tick) + 3} textAnchor="end" {...TICK}>
                    {metric === 'activity' ? number(tick, 2) : `${tick > 0 ? '+' : ''}${number(tick)}%`}
                  </text>
                </g>
              ))}
              {monthValues.map((value, m) => {
                const x = left + m * bw + bw * 0.12;
                const y = monthY(value);
                return (
                  <g key={m}>
                    <rect x={x} y={Math.min(y, monthZero)} width={bw * 0.76} height={Math.max(Math.abs(monthZero - y), 1)} rx={3} fill={metric === 'activity' ? 'var(--amber)' : value >= 0 ? 'var(--fire)' : 'var(--cyan)'} />
                    <text x={left + m * bw + bw / 2} y={value >= 0 ? y - 4 : y + 13} textAnchor="middle" fontSize={10} fill="var(--text)" fontFamily="var(--font-mono)">
                      {metric === 'activity' ? number(value, 1) : `${value > 0 ? '+' : ''}${number(value)}`}
                    </text>
                    <text x={left + m * bw + bw / 2} y={H - 9} textAnchor="middle" {...TICK}>
                      {monthNames[m]}
                    </text>
                  </g>
                );
              })}
              <line x1={left} x2={W - 12} y1={monthZero} y2={monthZero} stroke="var(--text-subtle)" strokeWidth={1} />
            </svg>
            <p className="text-meta text-ink-subtle mt-1 leading-snug">
              {unitLabel} · {metric === 'anomaly' ? t('monthlyAnomaly') : t('monthlyNote')}
            </p>
          </div>

            {/* Historical annual activity */}
            <div className={panel}>
              <h3 className="text-body font-semibold">{t('annualTitle')}</h3>
              <p className="text-meta text-ink-subtle">{t('annualSub', { name: place.name })}</p>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('annualTitle')} className="mx-auto mt-2 w-full max-w-md">
                {annual.ticks.map((tick) => (
                  <g key={tick}>
                    <line x1={left} x2={W - 12} y1={lineY(tick)} y2={lineY(tick)} {...GRID} />
                    <text x={left - 6} y={lineY(tick) + 3} textAnchor="end" {...TICK}>
                      {number(tick)}
                    </text>
                  </g>
                ))}
                <polyline points={series.map((r, i) => `${lineX(i)},${lineY(r.count)}`).join(' ')} fill="none" stroke="var(--cyan)" strokeWidth={2.5} strokeLinejoin="round" />
                {series.map((row, i) => (
                  <g key={row.year}>
                    <circle cx={lineX(i)} cy={lineY(row.count)} r={row.year === year ? 5.5 : 3} fill={row.year === year ? 'var(--fire)' : 'var(--cyan)'} stroke={row.year === year ? 'var(--text)' : 'none'} strokeWidth={1.5} />
                    {row.year === year && (
                      <text x={lineX(i) + (i > series.length / 2 ? -9 : 9)} y={lineY(row.count) - 8} textAnchor={i > series.length / 2 ? 'end' : 'start'} {...TICK} fill="var(--text)">
                        {number(row.count)}
                      </text>
                    )}
                    {i % 4 === 0 && (
                      <text x={lineX(i)} y={H - 9} textAnchor="middle" {...TICK}>
                        {row.year}
                      </text>
                    )}
                  </g>
                ))}
                <line x1={left} x2={W - 12} y1={top + plotH} y2={top + plotH} stroke="var(--text-subtle)" strokeWidth={1} />
              </svg>
              <p className="text-meta text-ink mt-1 font-mono" aria-live="polite">
                {readRow ? t('readout', { year: readRow.year, count: number(readRow.count), sampled: number(readRow.sampled) }) : ''}
              </p>
              <p className="text-meta text-ink-subtle mt-1">{t('annualNote')}</p>
            </div>

            {/* Top regions */}
            <div className={`${panel} md:col-span-2 xl:col-span-1`}>
              <h3 className="text-body flex items-center gap-2 font-semibold">
                <span aria-hidden="true" className="text-amber">▤</span>
                {t('topTitle', { year })}
              </h3>
              <p className="text-meta text-ink-subtle">{t('topSub')}</p>
              <svg viewBox={`0 0 ${W} ${barsH}`} role="img" aria-label={t('topTitle', { year })} className="mx-auto mt-2 w-full max-w-md">
                {barAxis.ticks.map((tick) => {
                  const x = barsLeft + (tick / barAxis.top) * barsW;
                  return (
                    <g key={tick}>
                      <line x1={x} x2={x} y1={0} y2={top10.length * rowH} {...GRID} />
                      <text x={x} y={top10.length * rowH + 16} textAnchor="middle" {...TICK}>
                        {number(tick)}
                      </text>
                    </g>
                  );
                })}
                {top10.map((row, i) => {
                  const active = row.place.id === place.id;
                  return (
                    <g key={row.place.id}>
                      <text x={barsLeft - 8} y={i * rowH + 16} textAnchor="end" fontSize={11} fill={active ? 'var(--text)' : 'var(--text-muted)'} fontWeight={active ? 700 : 400}>
                        {row.place.name.length > 14 ? `${row.place.name.slice(0, 13)}…` : row.place.name}
                      </text>
                      <rect x={barsLeft} y={i * rowH + 3} width={Math.max((row.count / barAxis.top) * barsW, 1.5)} height={rowH - 6} rx={3} fill={active ? 'var(--fire)' : 'var(--amber)'} />
                      <text x={barsLeft + Math.max((row.count / barAxis.top) * barsW, 1.5) + 5} y={i * rowH + 15} fontSize={11} fill="var(--text)" fontFamily="var(--font-mono)">
                        {number(row.count)}
                      </text>
                    </g>
                  );
                })}
                <line x1={barsLeft} x2={barsLeft} y1={0} y2={top10.length * rowH} stroke="var(--text-subtle)" strokeWidth={1} />
              </svg>
              <p className="text-meta text-ink-subtle mt-1">{t('topNote')}</p>
            </div>
          </div>
          <p className="text-meta text-ink-subtle mt-2 max-w-4xl">{t('method')}</p>
        </>
      )}
    </section>
  );
}
