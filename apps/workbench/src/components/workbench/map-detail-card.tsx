'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDecimal } from '@/lib/workbench/format';
import type { MapDetail, MapSelect } from '@/lib/workbench/map-data';

const TONE: Record<MapSelect['status'], string> = {
  keep: 'var(--raw)',
  sza: 'var(--grey)',
  static: 'var(--purple)',
  saa: 'var(--grey)',
  dup: 'var(--grey)',
};

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

/** Pinned card for a clicked dot: what the detection is, and why it is or is not counted. */
export function MapDetailCard({
  selected,
  detail,
  loading,
  year,
  onClose,
}: {
  selected: MapSelect;
  detail: MapDetail | null;
  loading: boolean;
  year: number;
  onClose: () => void;
}) {
  const t = useTranslations('Map.detail');
  const locale = useLocale();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { point, status } = selected;
  const sensor = point.s === 'm' ? 'MODIS' : 'VIIRS';
  const area = point.sc * point.tr;

  let power = '';
  let location = '';
  let when = '';
  let sun = '';
  let confidence = '';
  if (detail) {
    const [lon, lat, frp, time, sza, conf] = detail;
    const level = frp < 10 ? 'small' : frp < 50 ? 'moderate' : 'intense';
    power = `${formatDecimal(frp, locale)} MW · ${t(`level.${level}`)}`;
    location = `${coordinate(lat, 'N', 'S')}, ${coordinate(lon, 'E', 'W')}`;
    when = `${year}-${time} UTC`;
    sun = `${formatDecimal(sza, locale)}° · ${sza >= 85 ? t('sunNight') : t('sunDay')}`;
    const lowered = conf.toLowerCase();
    confidence = /^\d+$/.test(lowered)
      ? `${lowered}%`
      : lowered === 'l'
        ? t('conf.low')
        : lowered === 'h'
          ? t('conf.high')
          : lowered === 'n'
            ? t('conf.nominal')
            : conf;
  }

  const rows: { label: string; value: string; hint?: string }[] = [
    { label: t('location'), value: location },
    { label: t('time'), value: when },
    { label: t('power'), value: power, hint: t('powerHint') },
    { label: t('area'), value: `${formatDecimal(area, locale)} km²`, hint: t('areaHint') },
    {
      label: t('angle'),
      value: `${formatDecimal(point.ang, locale)}°`,
      hint: t('angleHint'),
    },
    { label: t('sun'), value: sun },
    { label: t('confidence'), value: confidence },
  ];

  return (
    <aside
      aria-label={t('title')}
      className="border-line bg-panel flex shrink-0 flex-col overflow-hidden rounded-md border"
    >
      <div className="border-line flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <span className="text-micro text-ink-subtle block tracking-wide uppercase">
            {t('title')}
          </span>
          <span className="text-meta block font-semibold">
            {sensor} · {point.pf || sensor} · {point.dn === 'N' ? t('night') : t('day')}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="text-ink-muted hover:text-ink -mt-0.5 shrink-0 rounded px-1.5 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="px-3 py-3">
        <div className="rounded-md border p-2" style={{ borderColor: TONE[status] }}>
          <span className="text-meta block font-semibold" style={{ color: TONE[status] }}>
            {t(`headline.${status}`)}
          </span>
          <span className="text-micro text-ink-muted mt-1 block leading-relaxed">
            {t(`status.${status}`)}
          </span>
        </div>

        {loading && <p className="text-micro text-ink-subtle mt-2">{t('loading')}</p>}
        {!loading && !detail && <p className="text-micro text-ink-subtle mt-2">{t('unavailable')}</p>}

        {detail && (
          <dl className="divide-line mt-3 divide-y">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-2 first:pt-0"
              >
                <dt className="text-micro text-ink-muted font-medium">{row.label}</dt>
                <dd className="text-micro text-ink text-right font-mono tabular-nums break-words">
                  {row.value}
                </dd>
                {row.hint && (
                  <p className="text-micro text-ink-subtle col-span-2 leading-snug">{row.hint}</p>
                )}
              </div>
            ))}
          </dl>
        )}
        {detail && (
          <p className="text-micro text-ink-subtle border-line mt-1 border-t pt-2 leading-relaxed">
            {t('hover')}
          </p>
        )}
      </div>
    </aside>
  );
}
