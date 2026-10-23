import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalize';
import { rankTeams } from '../src/rank';

describe('normalize', () => {
  it('trims and ignores case by default', () => expect(normalize('  HeLLo ')).toBe('hello'));
  it('supports optional rules', () => {
    expect(normalize('A,  b!', { stripPunctuation: true, collapseSpaces: true })).toBe('a b');
    expect(normalize('a b', { stripSpaces: true })).toBe('ab');
  });
});

describe('rankTeams', () => {
  it('sorts desc, shares rank on ties, tie-breaks by name', () => {
    const r = rankTeams([
      { name: 'B', score: 100 }, { name: 'A', score: 100 }, { name: 'C', score: 250 }, { name: 'D', score: -4 },
    ]);
    expect(r.map((t) => [t.name, t.rank])).toEqual([['C', 1], ['A', 2], ['B', 2], ['D', 4]]);
  });
});
