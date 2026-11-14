import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { WorkbenchShell } from '@/components/workbench/workbench-shell';
import { loadCalendar } from '@/lib/calendar/load';
import { REGION_IDS } from '@/lib/calendar/types';
import { loadWorkbench } from '@/lib/workbench/series';

type WorkbenchParams = Promise<{ zone: string }>;
type WorkbenchSearchParams = Promise<{ epoch?: string; tour?: string }>;

const loadingFallback = <div className="bg-canvas h-dvh" />;

export async function generateMetadata() {
  return {
    title: 'Workbench',
    robots: { index: false, follow: false },
  };
}

export default async function WorkbenchZonePage({
  params,
  searchParams,
}: {
  params: WorkbenchParams;
  searchParams: WorkbenchSearchParams;
}) {
  const [{ zone }, query, dataset] = await Promise.all([params, searchParams, loadCalendar()]);
  const region = REGION_IDS.find((id) => id === zone);
  if (!region) notFound();

  const workbench = await loadWorkbench(dataset);
  const epochs = workbench.epochs[region];
  const requested = Number(query.epoch);
  const valid = Number.isInteger(requested) && epochs.some((epoch) => epoch.year === requested);
  const fallback = epochs.find((epoch) => epoch.year === 2024)?.year ?? epochs[0]?.year ?? 2001;

  return (
    <Suspense fallback={loadingFallback}>
      <WorkbenchShell
        key={region}
        dataset={dataset}
        workbench={workbench}
        initialRegion={region}
        initialYear={valid ? requested : fallback}
        initialTour={query.tour === '1'}
      />
    </Suspense>
  );
}
