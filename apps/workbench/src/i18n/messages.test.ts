import { describe, expect, test } from 'bun:test';
import en from './messages/en.json';
import hi from './messages/hi.json';
import vi from './messages/vi.json';

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    `${prefix}${key}`,
    ...keys(child, `${prefix}${key}.`),
  ]);
}

const at = (catalog: unknown, key: string) =>
  key.split('.').reduce<unknown>((node, part) => {
    if (!node || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[part];
  }, catalog);

describe('message catalogs', () => {
  test('VI (kept, not offered) has the same key set as EN', () => {
    expect(keys(vi).sort()).toEqual(keys(en).sort());
  });

  test('HI only translates keys that exist in EN (the rest falls back to English)', () => {
    const known = new Set(keys(en));
    // "Header.lang.hi" is the language's own name, added to EN as well
    expect(keys(hi).filter((key) => !known.has(key))).toEqual([]);
  });

  test('HI keeps every {placeholder} of the English text', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
    for (const key of keys(hi)) {
      const [h, e] = [at(hi, key), at(en, key)];
      if (typeof h === 'string' && typeof e === 'string') expect({ key, p: names(h) }).toEqual({ key, p: names(e) });
    }
  });

  test('no empty values', () => {
    for (const [locale, catalog] of [
      ['en', en],
      ['hi', hi],
      ['vi', vi],
    ] as const) {
      const empty = keys(catalog).filter((key) => {
        const value = at(catalog, key);
        return typeof value === 'string' && value.trim() === '';
      });
      expect({ locale, empty }).toEqual({ locale, empty: [] });
    }
  });
});
