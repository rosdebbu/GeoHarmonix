import type { RegionId } from '@/lib/calendar/types';

export type Intent =
  | { kind: 'region'; region: RegionId }
  | { kind: 'year'; year: number }
  | { kind: 'run'; useCase: 'UC-2.2' | 'UC-S1.4' }
  | { kind: 'feed' | 'evidence' | 'tour' | 'present' | 'help' };

// shortcut: keyword matching, not a language model; swap for the ai-service chat once model keys exist.
const REGIONS: [RegionId, RegExp][] = [
  ['india', /india|bangladesh|myanmar|punjab|south asia/],
  ['mekong', /mekong|vietnam|laos|cambodia|thailand/],
  ['amazon', /amazon|brazil|peru|bolivia|colombia/],
  ['maritime', /maritime|indonesia|malaysia|philippines|borneo|sumatra/],
];

/** Everything the text asks for, in the order it should happen (region before year). */
export function interpret(text: string): Intent[] {
  const said = text.toLowerCase();
  const out: Intent[] = [];
  const region = REGIONS.find(([, pattern]) => pattern.test(said));
  if (region) out.push({ kind: 'region', region: region[0] });
  const year = said.match(/\b(20[0-2]\d)\b/);
  if (year) out.push({ kind: 'year', year: Number(year[1]) });
  if (/tactical|dispatch|uc-?2\.2|ranger/.test(said)) out.push({ kind: 'run', useCase: 'UC-2.2' });
  else if (/flash|alert|uc-?s?1\.4|nrt/.test(said)) out.push({ kind: 'run', useCase: 'UC-S1.4' });
  if (/nasa|satellite|feed|live|real data|receiving|coming in/.test(said)) out.push({ kind: 'feed' });
  if (/evidence|proof|physics/.test(said)) out.push({ kind: 'evidence' });
  if (/tour|guide me|walk/.test(said)) out.push({ kind: 'tour' });
  if (/present|full screen|big/.test(said)) out.push({ kind: 'present' });
  if (out.length === 0 || /help|what can you|ideas?|suggest/.test(said)) out.push({ kind: 'help' });
  return out;
}
