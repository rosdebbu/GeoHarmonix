import { REGIONS, getFeed } from '@/lib/nasa-feed';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = params.get('region') ?? '';
  if (!REGIONS.includes(region)) return Response.json({ error: 'unknown region' }, { status: 400 });
  return Response.json(await getFeed(region, params.has('fresh')));
}
