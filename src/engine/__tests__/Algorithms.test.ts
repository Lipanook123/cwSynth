import { describe, it, expect } from 'vitest';
import { ALGORITHMS, expandAlgorithm, carriersOf, getAlgorithm } from '../Algorithms';
import { levelToIndex, MAX_FM_INDEX } from '../Operator';

describe('ALGORITHMS', () => {
  it('defines all 32 with sequential ids', () => {
    expect(ALGORITHMS).toHaveLength(32);
    expect(ALGORITHMS.map(a => a.id)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it('only references operator indices 0-5', () => {
    for (const a of ALGORITHMS) {
      for (const c of a.carriers) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(6);
      }
      for (const [t, s] of a.modulators) {
        expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(6);
        expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(6);
      }
    }
  });

  it('gives every algorithm at least one carrier', () => {
    for (const a of ALGORITHMS) expect(a.carriers.length).toBeGreaterThan(0);
  });

  it('falls back to algorithm 1 for an unknown id', () => {
    expect(getAlgorithm(999).id).toBe(1);
    expect(getAlgorithm(-5).id).toBe(1);
  });
});

describe('expandAlgorithm', () => {
  it('produces one route per modulator pair plus one per carrier', () => {
    for (const a of ALGORITHMS) {
      const routes = expandAlgorithm(a.id);
      expect(routes).toHaveLength(a.modulators.length + a.carriers.length);
    }
  });

  it('maps [target, source] pairs to from/to correctly', () => {
    // Algorithm 1 is the pure chain 6→5→4→3→2→1 with op1 as the only carrier.
    const routes = expandAlgorithm(1);
    const fm = routes.filter(r => r.kind === 'fm');
    // ALGORITHMS stores [target, source]; a route is from=source, to=target.
    expect(fm).toContainEqual({ from: 1, to: 0, kind: 'fm', amount: 1 });
    expect(fm).toContainEqual({ from: 5, to: 4, kind: 'fm', amount: 1 });
  });

  it('marks carriers as mix routes to the output', () => {
    const routes = expandAlgorithm(5);
    const mix = routes.filter(r => r.to === 'out');
    expect(mix.map(r => r.from).sort()).toEqual([0, 2, 4]);
    expect(mix.every(r => r.kind === 'mix')).toBe(true);
  });

  it('round-trips carriers through carriersOf', () => {
    for (const a of ALGORITHMS) {
      expect(carriersOf(expandAlgorithm(a.id)).sort()).toEqual([...a.carriers].sort());
    }
  });

  it('makes algorithm 16 fully additive', () => {
    const routes = expandAlgorithm(16);
    expect(routes.every(r => r.to === 'out')).toBe(true);
    expect(routes).toHaveLength(6);
  });
});

describe('levelToIndex', () => {
  it('is zero at zero and maxes out at level 1', () => {
    expect(levelToIndex(0)).toBe(0);
    expect(levelToIndex(1)).toBeCloseTo(MAX_FM_INDEX, 6);
  });

  it('increases monotonically', () => {
    let prev = -1;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const idx = levelToIndex(l);
      expect(idx).toBeGreaterThan(prev);
      prev = idx;
    }
  });

  it('is curved, so mid-travel is well below half the maximum', () => {
    // A linear mapping would put every usable timbre at the bottom of the knob.
    expect(levelToIndex(0.5)).toBeLessThan(MAX_FM_INDEX * 0.25);
  });

  it('clamps levels above 1', () => {
    expect(levelToIndex(5)).toBeCloseTo(MAX_FM_INDEX, 6);
  });
});
