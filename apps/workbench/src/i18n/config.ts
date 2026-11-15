export const LOCALE_COOKIE = 'fc-locale';

// English and Hindi. The Vietnamese catalog (messages/vi.json) is kept but is no longer offered.
export const locales = ['en', 'hi'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'hi';
}
