'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { fold, loadPlaces, statsFor, type MapPlace } from '@/lib/workbench/map-search';

const MAX_RESULTS = 8;

/** Search a country, state or province; pick one to fly the map there and read its fire stats. */
export function MapSearch({
  region,
  year,
  place,
  onPlace,
}: {
  region: string;
  year: number;
  place: MapPlace | null;
  onPlace: (place: MapPlace | null) => void;
}) {
  const t = useTranslations('Map.search');
  const locale = useLocale();
  const whole = (value: number) => new Intl.NumberFormat(locale).format(value);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [places, setPlaces] = useState<MapPlace[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setPlaces(null);
    onPlace(null);
    setQuery('');
  }, [region, onPlace]);

  const load = () => {
    if (places) return;
    void loadPlaces(region).then(setPlaces);
  };

  const needle = fold(query.trim());
  const results = useMemo(() => {
    if (!places) return [];
    if (!needle) {
      // Nothing typed: the states with the most counted detections this year.
      return places
        .filter((item) => item.kind === 'state')
        .sort((a, b) => statsFor(b, year)[1] - statsFor(a, year)[1])
        .slice(0, MAX_RESULTS);
    }
    return places
      .filter((item) => fold(item.name).includes(needle) || fold(item.parent).includes(needle))
      .sort((a, b) => {
        const starts = Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle));
        return starts || Number(b.kind === 'country') - Number(a.kind === 'country');
      })
      .slice(0, MAX_RESULTS);
  }, [places, needle, year]);

  const choose = (item: MapPlace) => {
    onPlace(item);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const [sampled, counted] = place ? statsFor(place, year) : [0, 0];
  const states = useMemo(
    () => (places ?? []).filter((item) => item.kind === 'state'),
    [places],
  );
  const siblings = place?.kind === 'state' ? states.filter((item) => item.parent === place.parent) : [];
  const rank =
    place?.kind === 'state'
      ? siblings.filter((item) => statsFor(item, year)[1] > counted).length + 1
      : 0;
  const country = place
    ? (places ?? []).find((item) =>
        place.kind === 'country' ? false : item.kind === 'country' && item.name === place.parent,
      )
    : undefined;
  const countryCounted = country ? statsFor(country, year)[1] : 0;
  const share = countryCounted > 0 ? Math.round((counted / countryCounted) * 100) : 0;

  const trend = useMemo(
    () =>
      Object.keys(place?.s ?? {})
        .map(Number)
        .sort((a, b) => a - b)
        .map((y) => ({ year: y, count: place!.s[String(y)]![1] })),
    [place],
  );
  const busiest = trend.reduce<(typeof trend)[number] | null>((best, row) => (!best || row.count > best.count ? row : best), null);
  const before = trend.filter((row) => row.year < year).at(-1);
  const change = before && before.count > 0 ? { prev: before.year, pct: Math.round(((counted - before.count) / before.count) * 100) } : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-line bg-panel/95 relative rounded-md border">
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t('label')}
          placeholder={t('placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            load();
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="text-meta text-ink placeholder:text-ink-subtle w-full bg-transparent px-2.5 py-1.5 outline-none"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="border-line bg-panel absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border py-1"
          >
            {!places && <li className="text-micro text-ink-subtle px-2.5 py-1.5">{t('loading')}</li>}
            {places && !needle && results.length > 0 && (
              <li className="text-micro text-ink-subtle px-2.5 py-1 tracking-wide uppercase">
                {t('hotspots', { year })}
              </li>
            )}
            {places && results.length === 0 && (
              <li className="text-micro text-ink-subtle px-2.5 py-1.5">{t('none')}</li>
            )}
            {results.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-baseline justify-between gap-2 px-2.5 py-1 ${
                  index === active ? 'bg-chip' : ''
                }`}
              >
                <span className="text-meta min-w-0 truncate">
                  {item.name}
                  <span className="text-micro text-ink-subtle ml-1.5">
                    {item.kind === 'country' ? t('country') : item.parent}
                  </span>
                </span>
                <span className="text-micro text-ink-muted shrink-0 font-mono">
                  {whole(statsFor(item, year)[1])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {place && (
        <div className="border-line bg-panel rounded-md border p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-meta block font-semibold">{place.name}</span>
              <span className="text-micro text-ink-subtle block">
                {place.kind === 'country' ? t('country') : `${t('state')} · ${place.parent}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onPlace(null)}
              aria-label={t('clear')}
              className="text-ink-muted hover:text-ink -mt-0.5 shrink-0 rounded px-1.5 text-lg leading-none"
            >
              ×
            </button>
          </div>
          <dl className="mt-2 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-micro text-ink-subtle">{t('year')}</dt>
              <dd className="text-micro font-mono">{year}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-micro text-ink-subtle">{t('sampled')}</dt>
              <dd className="text-micro font-mono">{whole(sampled)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-micro text-ink-subtle">{t('counted')}</dt>
              <dd className="text-micro font-mono">{whole(counted)}</dd>
            </div>
            {place.kind === 'state' && sampled > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-micro text-ink-subtle">{t('rank')}</dt>
                  <dd className="text-micro font-mono">
                    #{rank} / {siblings.length}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-micro text-ink-subtle">{t('share', { country: place.parent })}</dt>
                  <dd className="text-micro font-mono">{share}%</dd>
                </div>
              </>
            )}
          </dl>
          {trend.length > 1 && (
            <div className="border-line mt-2 border-t pt-2">
              <span className="text-micro text-ink-subtle block tracking-wide uppercase">{t('summaryTitle')}</span>
              <p className="text-meta mt-1 leading-snug">{t('headline', { count: counted, name: place.name, year })}</p>
              {change && (
                <p className="text-micro text-ink-muted mt-0.5">
                  {change.pct === 0 ? t('flat', { prev: change.prev }) : t(change.pct > 0 ? 'up' : 'down', { pct: Math.abs(change.pct), prev: change.prev })}
                </p>
              )}
              {busiest && busiest.count > 0 && <p className="text-micro text-ink-muted mt-0.5">{t('busiest', { year: busiest.year, count: busiest.count })}</p>}
              <svg role="img" aria-label={t('trendTitle')} viewBox={`0 0 ${trend.length * 8} 36`} className="mt-1.5 h-9 w-full">
                {trend.map((row, index) => {
                  const h = busiest && busiest.count > 0 ? Math.max(row.count > 0 ? 2 : 0.6, (row.count / busiest.count) * 34) : 0.6;
                  return (
                    <rect
                      key={row.year}
                      x={index * 8 + 1}
                      y={35 - h}
                      width={6}
                      height={h}
                      fill={row.year === year ? 'var(--amber)' : 'var(--line-strong)'}
                    >
                      <title>{`${row.year}: ${row.count}`}</title>
                    </rect>
                  );
                })}
              </svg>
              <span className="text-micro text-ink-subtle flex justify-between font-mono">
                <span>{trend[0]!.year}</span>
                <span>{trend.at(-1)!.year}</span>
              </span>
            </div>
          )}
          <p className="text-micro text-ink-subtle mt-2 leading-snug">
            {sampled === 0 ? t('empty') : t('note')}
          </p>
        </div>
      )}
    </div>
  );
}
