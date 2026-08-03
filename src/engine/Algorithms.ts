// 32 DX7-style algorithms.
// Each algorithm defines:
//   carriers: operator indices that connect to audio output
//   modulators: [target, source][] — source modulates target's frequency
// Operators indexed 0-5 (OP1-OP6)
//
// These 32 entries are the *data source* for the general routing matrix — see
// expandAlgorithm() at the bottom of this file. Voice consumes Route[], never
// AlgorithmDef directly, so custom routings, ring-mod and osc sync all have a
// home without touching the algorithm picker UI.

import type { Route } from './Types';

export interface AlgorithmDef {
  id: number;
  carriers: number[];
  modulators: [number, number][]; // [target, source]
  label: string;
}

export const ALGORITHMS: AlgorithmDef[] = [
  // 1: 6→5→4→3→2→1 (pure series chain)
  { id: 1,  carriers: [0], modulators: [[1,2],[2,3],[3,4],[4,5],[0,1]], label: '6→5→4→3→2→1' },
  // 2: (6→5→4→3→2)→1
  { id: 2,  carriers: [0], modulators: [[1,2],[2,3],[3,4],[4,5],[0,1]], label: '(6→5)4→3→2→1' },
  // 3: (6→5→4)+(3→2→1)
  { id: 3,  carriers: [0,3], modulators: [[1,2],[0,1],[4,5],[3,4]], label: '(6→5→4)+(3→2→1)' },
  // 4: (6→5→4→3)+2→1
  { id: 4,  carriers: [0,3], modulators: [[1,2],[2,3],[3,4],[4,5],[0,1]], label: '(6→5→4→3)+2→1' },
  // 5: (6→5)+(4→3)+(2→1)
  { id: 5,  carriers: [0,2,4], modulators: [[0,1],[2,3],[4,5]], label: '(6→5)+(4→3)+(2→1)' },
  // 6: (6+5+4+3)→2→1
  { id: 6,  carriers: [0], modulators: [[1,2],[1,3],[1,4],[1,5],[0,1]], label: '(6+5+4+3)→2→1' },
  // 7: (6+5+4)→3+2→1
  { id: 7,  carriers: [0,2], modulators: [[2,3],[2,4],[2,5],[0,1]], label: '(6+5+4)→3+2→1' },
  // 8: (6+5)→4+3+2→1
  { id: 8,  carriers: [0,2,3], modulators: [[3,4],[3,5],[0,1],[2,1]], label: '(6+5)→4+3+2→1' },
  // 9: (6→5→4)+(3+2)→1
  { id: 9,  carriers: [0], modulators: [[1,2],[0,1],[0,3],[0,4],[2,5],[3,4]], label: '(6→5→4)+(3+2)→1' },
  // 10: (6→5+4+3+2)→1
  { id: 10, carriers: [0], modulators: [[0,1],[0,2],[0,3],[0,4],[4,5]], label: '(6→5+4+3+2)→1' },
  // 11: (6+5+4+3+2)→1
  { id: 11, carriers: [0], modulators: [[0,1],[0,2],[0,3],[0,4],[0,5]], label: '(6+5+4+3+2)→1' },
  // 12: 6→(5+4+3+2+1)
  { id: 12, carriers: [0,1,2,3,4], modulators: [[0,5],[1,5],[2,5],[3,5],[4,5]], label: '6→(5+4+3+2+1)' },
  // 13: (6→5)+(4→3)+(2)+(1)
  { id: 13, carriers: [0,1,2,4], modulators: [[2,3],[4,5]], label: '(6→5)+(4→3)+2+1' },
  // 14: (6→5→4)+(3)+(2)+(1)
  { id: 14, carriers: [0,1,2,3], modulators: [[3,4],[3,5]], label: '(6→5→4)+3+2+1' },
  // 15: (6→5)+(4)+(3)+(2)+(1)
  { id: 15, carriers: [0,1,2,3,4], modulators: [[4,5]], label: '(6→5)+4+3+2+1' },
  // 16: all carriers (additive)
  { id: 16, carriers: [0,1,2,3,4,5], modulators: [], label: '1+2+3+4+5+6 (additive)' },
  // 17: 6→5, rest carriers
  { id: 17, carriers: [0,1,2,3,4], modulators: [[4,5]], label: '6→5+4+3+2+1' },
  // 18: 6→(5→4)+(3)+(2)+(1)
  { id: 18, carriers: [0,1,2,3], modulators: [[3,4],[3,5],[4,5]], label: '(6→5→4)+3+2+1 v2' },
  // 19: ((6+5)→4→3)+(2→1)
  { id: 19, carriers: [0,2], modulators: [[2,3],[3,4],[3,5],[0,1]], label: '((6+5)→4→3)+(2→1)' },
  // 20: (6→5→4→3)+(2+1)
  { id: 20, carriers: [0,1], modulators: [[2,3],[3,4],[4,5],[2,1]], label: '(6→5→4→3)+(2+1)' },
  // 21: (6→5→4)+(3→2→1)
  { id: 21, carriers: [0,3], modulators: [[1,2],[0,1],[4,5],[3,4]], label: '(6→5→4)+(3→2→1) v2' },
  // 22: (6+5→4→3→2→1)
  { id: 22, carriers: [0], modulators: [[1,2],[2,3],[3,4],[4,5],[4,0]], label: '6+5→4→3→2→1' },
  // 23: 6→5+4+3+(2→1)
  { id: 23, carriers: [0,2,3,4], modulators: [[0,1],[4,5]], label: '6→5+4+3+(2→1)' },
  // 24: (6→5→4+3+2+1)
  { id: 24, carriers: [0,1,2,3], modulators: [[3,4],[3,5]], label: '(6→5→4)+3+2+1 v3' },
  // 25: (6+5→4+3)+(2→1)
  { id: 25, carriers: [0,2,3], modulators: [[2,4],[2,5],[0,1]], label: '(6+5→4+3)+(2→1)' },
  // 26: (6→5+4→3+2+1)
  { id: 26, carriers: [0,1,2], modulators: [[2,3],[2,4],[0,1],[3,5]], label: '(6→5+4→3)+2+1' },
  // 27: (6→5→4+3→2→1)
  { id: 27, carriers: [0], modulators: [[1,2],[1,3],[0,1],[3,4],[3,5]], label: '(6→5→4+3→2→1)' },
  // 28: feedback on op6 self, 6→5→4→3→2→1
  { id: 28, carriers: [0], modulators: [[1,2],[2,3],[3,4],[4,5],[0,1]], label: '6fb→5→4→3→2→1' },
  // 29: (6→5)+(4+3→2→1)
  { id: 29, carriers: [0,4], modulators: [[0,1],[0,2],[0,3],[4,5]], label: '(6→5)+(4+3→2→1)' },
  // 30: (6+5+4→3→2→1)
  { id: 30, carriers: [0], modulators: [[1,2],[2,3],[2,4],[2,5],[0,1]], label: '(6+5+4→3→2→1)' },
  // 31: (6→5→4→3)+(2→1)
  { id: 31, carriers: [0,2], modulators: [[2,3],[3,4],[4,5],[0,1]], label: '(6→5→4→3)+(2→1)' },
  // 32: (6→5→4→3+2→1)
  { id: 32, carriers: [0], modulators: [[1,2],[1,3],[0,1],[3,4],[4,5]], label: '(6→5→4→3+2→1)' },
];

export function getAlgorithm(id: number): AlgorithmDef {
  return ALGORITHMS.find(a => a.id === id) ?? ALGORITHMS[0];
}

/**
 * Expand a DX-style algorithm into the general routing matrix.
 *
 * Carriers become 'mix' routes to the voice output; modulator pairs become 'fm'
 * routes. `amount` is 1 here — per-operator depth comes from the operator's own
 * level, which Voice converts to an FM index.
 */
export function expandAlgorithm(id: number): Route[] {
  const algo = getAlgorithm(id);
  const routes: Route[] = [];

  for (const [target, source] of algo.modulators) {
    routes.push({ from: source, to: target, kind: 'fm', amount: 1 });
  }
  for (const carrier of algo.carriers) {
    routes.push({ from: carrier, to: 'out', kind: 'mix', amount: 1 });
  }
  return routes;
}

/** Operators that reach the output directly, derived from any routing matrix. */
export function carriersOf(routes: Route[]): number[] {
  return routes.filter(r => r.to === 'out').map(r => r.from);
}
