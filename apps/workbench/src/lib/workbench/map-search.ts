import { clampView, type MapView } from './map-view';

/** One searchable place: a focus country or one of its states/provinces. */
export type MapPlace = {
  id: string;
  name: string;
  kind: 'country' | 'state';
  /** The country a state belongs to; empty for a country. */
  parent: string;
  /** Map-data country id, for countries (their outline is already in the map data). */
  cid: string;
  /** Projected outline of a state; empty for a country. */
  d: string;
  /** Projected bounding box [x0, y0, x1, y1] in map viewBox units. */
  b: [number, number, number, number];
  /** Per year: [sampled detections, counted detections] from the map's own sample. */
  s: Record<string, [number, number]>;
};

const cache = new Map<string, Promise<MapPlace[]>>();

/** The search index is a per-region file, fetched once on first use. */
export function loadPlaces(region: string): Promise<MapPlace[]> {
  let places = cache.get(region);
  if (!places) {
    places = fetch(`/map-search/${region}.json`)
      .then((response) => (response.ok ? (response.json() as Promise<MapPlace[]>) : []))
      .catch(() => []);
    cache.set(region, places);
  }
  return places;
}

/** Lower-case and strip accents so "Hà Nội" and "ha noi" match. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
}

/** The view that frames a projected box, filling `fill` of the canvas (never zoomed out past 1). */
export function frame(
  box: readonly number[],
  width: number,
  height: number,
  fill: number,
  maxZoom = 14,
): MapView {
  const [x0, y0, x1, y1] = box;
  const boxWidth = Math.max(x1 - x0, 8);
  const boxHeight = Math.max(y1 - y0, 8);
  const k = Math.min(Math.max(Math.min((width * fill) / boxWidth, (height * fill) / boxHeight), 1), maxZoom);
  return clampView(
    { k, x: width / 2 - k * ((x0 + x1) / 2), y: height / 2 - k * ((y0 + y1) / 2) },
    width,
    height,
  );
}

/** The view that frames a place with some margin. */
export function viewFor(place: MapPlace, width: number, height: number): MapView {
  return frame(place.b, width, height, 0.55);
}

/** [sampled, counted] for a year; zeros when the place has no sampled detection that year. */
export function statsFor(place: MapPlace, year: number): [number, number] {
  return place.s[String(year)] ?? [0, 0];
}
