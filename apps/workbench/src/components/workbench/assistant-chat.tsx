'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { interpret, type Intent } from '@/lib/workbench/assistant';
import type { RegionId } from '@/lib/calendar/types';

export type AssistantActions = {
  region: RegionId;
  years: number[];
  onRegion: (region: RegionId) => void;
  onYear: (year: number) => void;
  /** Returns false when the service is not connected, so nothing started. */
  onRun: (useCase: 'UC-2.2' | 'UC-S1.4') => boolean;
  onEvidence: () => void;
  onTour: () => void;
  onPresent: () => void;
};

type Message = { from: 'me' | 'ai'; text: string };

const IDEAS = [
  'Is NASA data coming in?',
  'Show Mekong 2019',
  'Show the Amazon',
  'Run the tactical dispatch',
  'Open the evidence',
];

const HELP =
  'I can switch the region or year, run a briefing, open the evidence or the tour, and check the live NASA feed. Pick an idea below or tell me what to do.';

async function feedReport(region: RegionId): Promise<string> {
  const response = await fetch(`/api/nasa-feed?region=${region}`);
  if (!response.ok) return 'I could not reach NASA FIRMS just now.';
  const { sensors, keyMissing } = (await response.json()) as {
    keyMissing: boolean;
    sensors: {
      label: string;
      latest: string | null;
      error: boolean;
      pulledAt: string | null;
      recent: { at: string }[];
    }[];
  };
  if (keyMissing) return 'The server has no FIRMS_MAP_KEY, so it cannot pull live NASA data.';
  const now = Date.now();
  const day = sensors.map((sensor) => sensor.recent.filter((d) => now - Date.parse(d.at) <= 86_400_000).length);
  const live = sensors.filter((sensor) => sensor.latest && now - Date.parse(sensor.latest) <= 12 * 3_600_000).length;
  if (sensors.every((sensor) => !sensor.pulledAt)) {
    return 'NASA is slow to answer right now and nothing has been pulled yet. It retries by itself; try again in a minute.';
  }
  const lines = sensors.map((sensor, i) => {
    if (!sensor.latest) return `• ${sensor.label}: ${sensor.error ? 'no answer from NASA yet' : 'silent, nothing in the last 3 days'}.`;
    const hours = Math.round((now - Date.parse(sensor.latest)) / 3_600_000);
    return `• ${sensor.label}: last detection ${hours} h ago, ${day[i]} in the last 24 h.`;
  });
  const oldest = Math.min(...sensors.flatMap((sensor) => (sensor.pulledAt ? [Date.parse(sensor.pulledAt)] : [])));
  const minutes = Math.round((now - oldest) / 60_000);
  const stale = sensors.some((sensor) => sensor.error) ? ' NASA was slow on the last try, so some of this is older.' : '';
  return `${live > 0 ? 'Yes' : 'Not in the last 12 h'}: ${live} of ${sensors.length} satellites reported in the last 12 h, ${day.reduce((a, b) => a + b, 0)} detections in 24 h over this area.\n${lines.join('\n')}\n(Pulled from NASA ${minutes} min ago.${stale} The live map is at the bottom of the page.)`;
}

export function AssistantChat(actions: AssistantActions) {
  const t = useTranslations('Assistant');
  const [messages, setMessages] = useState<Message[]>([{ from: 'ai', text: HELP }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const say = useCallback((message: Message) => {
    setMessages((current) => [...current, message]);
    queueMicrotask(() => end.current?.scrollIntoView({ block: 'end' }));
  }, []);

  const perform = useCallback(
    async (intent: Intent): Promise<string> => {
      switch (intent.kind) {
        case 'region':
          actions.onRegion(intent.region);
          return `Switched to ${intent.region}.`;
        case 'year':
          if (!actions.years.includes(intent.year))
            return `There is no measured epoch for ${intent.year}; try ${actions.years.at(-1)}.`;
          actions.onYear(intent.year);
          return `Showing ${intent.year}.`;
        case 'run':
          return actions.onRun(intent.useCase)
            ? `Started ${intent.useCase}. The run appears above and waits for sign-off if it needs one.`
            : 'Connect to the analysis service above first, then I can run a briefing.';
        case 'feed':
          return feedReport(actions.region);
        case 'evidence':
          actions.onEvidence();
          return 'Opened the evidence.';
        case 'tour':
          actions.onTour();
          return 'Starting the tour.';
        case 'present':
          actions.onPresent();
          return 'Toggled presentation mode.';
        default:
          return `Hi! ${HELP}`;
      }
    },
    [actions],
  );

  const send = useCallback(
    async (input: string) => {
      const value = input.trim();
      if (!value || busy) return;
      setText('');
      setBusy(true);
      say({ from: 'me', text: value });
      try {
        for (const intent of interpret(value)) {
          say({ from: 'ai', text: await perform(intent) });
        }
      } catch {
        say({ from: 'ai', text: 'That did not work; nothing was changed.' });
      } finally {
        setBusy(false);
      }
    },
    [busy, perform, say],
  );

  return (
    <section aria-label={t('title')} className="border-line flex flex-col gap-2 border-t pt-3">
      <h3 className="text-label text-ink-subtle font-mono tracking-widest uppercase">{t('title')}</h3>
      <div role="log" aria-live="polite" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {messages.map((message, index) => (
          <p
            key={index}
            className={`text-meta max-w-[90%] rounded-md px-2.5 py-1.5 whitespace-pre-line ${
              message.from === 'me' ? 'bg-seg text-ink self-end' : 'bg-chip text-ink-muted self-start'
            }`}
          >
            {message.text}
          </p>
        ))}
        <div ref={end} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            disabled={busy}
            onClick={() => void send(idea)}
            className="border-line text-micro text-ink-muted hover:bg-chip hover:text-ink rounded-full border px-2 py-1 disabled:opacity-50"
          >
            {idea}
          </button>
        ))}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="border-line-strong bg-panel text-meta min-w-0 flex-1 rounded-md border px-2 py-1.5"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="border-line-strong bg-seg text-meta rounded-md border px-3 font-medium disabled:opacity-50"
        >
          {t('send')}
        </button>
      </form>
      <p className="text-micro text-ink-subtle">{t('note')}</p>
    </section>
  );
}
