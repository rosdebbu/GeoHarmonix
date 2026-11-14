import { redirect } from 'next/navigation';
import { REGION_IDS } from '@/lib/calendar/types';

import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workbench',
  robots: { index: false, follow: false },
};

type WorkbenchSearchParams = Promise<{
  region?: string;
  epoch?: string;
  tour?: string;
}>;

export default async function WorkbenchRedirect({
  searchParams,
}: {
  searchParams: WorkbenchSearchParams;
}) {
  const params = await searchParams;
  const zone = REGION_IDS.find((id) => id === params.region) ?? 'mekong';
  const query = new URLSearchParams();
  if (params.epoch) query.set('epoch', params.epoch);
  if (params.tour) query.set('tour', params.tour);
  const suffix = query.toString();

  redirect(`/workbench/${zone}${suffix ? `?${suffix}` : ''}`);
}
