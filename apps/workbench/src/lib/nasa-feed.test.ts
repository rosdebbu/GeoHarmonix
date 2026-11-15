import { describe, expect, test } from 'bun:test';
import { parseFirms } from './nasa-feed';

const VIIRS =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n' +
  '10.29697,105.32738,326.2,0.39,0.36,2026-11-15,622,N20,VIIRS,n,2.0NRT,280.01,2.5,D\n' +
  '11.1,106.2,330,0.4,0.4,2026-11-15,1301,N20,VIIRS,n,2.0NRT,281,7.1,D';
// MODIS has no bright_ti4 and puts frp elsewhere; reading by name keeps it right.
const MODIS =
  'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n' +
  '9.5,104.1,320,1.1,1.0,2026-11-14,45,Terra,MODIS,80,6.1NRT,300,12.4,N';

describe('parseFirms', () => {
  test('reads VIIRS rows by column name, newest first, padding the time', () => {
    const rows = parseFirms(VIIRS);
    expect(rows.map((r) => r.at)).toEqual(['2026-11-15T13:01:00Z', '2026-11-15T06:22:00Z']);
    expect(rows[1]).toEqual({ lat: 10.29697, lon: 105.32738, frp: 2.5, at: '2026-11-15T06:22:00Z' });
  });

  test('reads MODIS frp from its own column', () => {
    expect(parseFirms(MODIS)[0]).toEqual({ lat: 9.5, lon: 104.1, frp: 12.4, at: '2026-11-14T00:45:00Z' });
  });

  test('rejects an error page instead of returning no rows', () => {
    expect(() => parseFirms('Invalid MAP_KEY.')).toThrow();
  });
});
