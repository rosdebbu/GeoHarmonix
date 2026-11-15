import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './config';

const messages = {
  en: () => import('./messages/en.json'),
  hi: () => import('./messages/hi.json'),
};

type Tree = { [key: string]: unknown };
const isTree = (value: unknown): value is Tree => !!value && typeof value === 'object' && !Array.isArray(value);

/** Hindi over English: any string not yet translated shows in English instead of failing. */
function overlay(base: Tree, top: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(top)) {
    const under = out[key];
    out[key] = isTree(under) && isTree(value) ? overlay(under, value) : value;
  }
  return out;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const candidate = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(candidate) ? candidate : defaultLocale;
  const english = (await messages.en()).default as Tree;

  return {
    locale,
    messages: locale === 'en' ? english : overlay(english, (await messages[locale]()).default as Tree),
  };
});
