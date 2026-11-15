import { describe, expect, test } from 'bun:test';
import { interpret } from './assistant';

describe('interpret', () => {
  test('puts the region before the year', () => {
    expect(interpret('show me Mekong in 2019')).toEqual([
      { kind: 'region', region: 'mekong' },
      { kind: 'year', year: 2019 },
    ]);
  });

  test('asks for the live feed and a briefing in one sentence', () => {
    expect(interpret('is NASA data coming in? run the tactical dispatch')).toEqual([
      { kind: 'run', useCase: 'UC-2.2' },
      { kind: 'feed' },
    ]);
  });

  test('falls back to help', () => {
    expect(interpret('hmm')).toEqual([{ kind: 'help' }]);
  });
});
