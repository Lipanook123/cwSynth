import {
  type PatchParams, type OperatorParams, type FilterParams, type FxParams,
  type LfoParams, DEFAULT_PATCH, type WaveType, type FilterType, type LfoShape,
} from './Types';
import { ALGORITHMS } from './Algorithms';

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
function mulberry32(seed: number) {
  return function (): number {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type RandomMode = 'safe' | 'wild';

export interface RandomContext {
  rng: () => number;
  mode: RandomMode;
}

function rc(seed: string | number, mode: RandomMode): RandomContext {
  const n = typeof seed === 'string' ? hashString(seed) : seed;
  return { rng: mulberry32(n), mode };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function rRange(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}
function rPick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function rBool(rng: () => number, prob = 0.5) {
  return rng() < prob;
}

// ── Individual parameter randomisers ──────────────────────────────────────

export function randomOperator(ctx: RandomContext, index: number): OperatorParams {
  const { rng, mode } = ctx;
  const waves: WaveType[] = mode === 'safe'
    ? ['sine', 'sine', 'sine', 'triangle']   // bias towards sine in safe
    : ['sine', 'triangle', 'sawtooth', 'square'];

  const safeRatios = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8];
  const ratio = mode === 'safe'
    ? rPick(rng, safeRatios)
    : rRange(rng, 0.5, 16);

  const isCarrier = index === 0; // index 0 is always a carrier in most algos
  const maxLevel  = isCarrier ? 1 : (mode === 'safe' ? 1.0 : 1.2);

  return {
    enabled:         rBool(rng, index < 4 ? 0.85 : 0.5),
    wave:            rPick(rng, waves),
    wavetableData:   null,
    ratio,
    fine:            mode === 'safe' ? rRange(rng, -20, 20) : rRange(rng, -100, 100),
    fixed:           mode === 'safe' ? false : rBool(rng, 0.1),
    fixedFreq:       rPick(rng, [55, 110, 220, 440, 880, 1760]),
    level:           rRange(rng, 0.3, maxLevel),
    feedback:        mode === 'safe' ? rRange(rng, 0, 0.15) : rRange(rng, 0, 0.6),
    attack:          mode === 'safe' ? rRange(rng, 0.001, 0.1)  : rRange(rng, 0.001, 2),
    decay:           mode === 'safe' ? rRange(rng, 0.05, 1.5)   : rRange(rng, 0.001, 6),
    sustain:         rRange(rng, 0, 1),
    release:         mode === 'safe' ? rRange(rng, 0.05, 1.0)   : rRange(rng, 0.001, 4),
    karplusStrong:   mode === 'safe' ? false : rBool(rng, 0.08),
    ksDecay:         rRange(rng, 0.97, 0.9995),
  };
}

export function randomFilter(ctx: RandomContext): FilterParams {
  const { rng, mode } = ctx;
  const types: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
  return {
    enabled:    rBool(rng, mode === 'safe' ? 0.4 : 0.6),
    type:       mode === 'safe' ? rPick(rng, ['lowpass', 'lowpass', 'highpass'] as FilterType[]) : rPick(rng, types),
    cutoff:     mode === 'safe' ? rRange(rng, 200, 8000) : rRange(rng, 20, 18000),
    resonance:  mode === 'safe' ? rRange(rng, 0.5, 8)   : rRange(rng, 0.1, 25),
    envAmount:  mode === 'safe' ? rRange(rng, 0, 0.7)   : rRange(rng, -1, 1),
    attack:     rRange(rng, 0.001, 0.5),
    decay:      rRange(rng, 0.05, 2),
    sustain:    rRange(rng, 0, 0.8),
    release:    rRange(rng, 0.05, 1.5),
    keytrack:   mode === 'safe' ? rRange(rng, 0, 0.7) : rRange(rng, 0, 1),
  };
}

export function randomFx(ctx: RandomContext): FxParams {
  const { rng, mode } = ctx;
  return {
    reverb: {
      enabled:  rBool(rng, mode === 'safe' ? 0.6 : 0.7),
      size:     mode === 'safe' ? rRange(rng, 0.2, 0.7) : rRange(rng, 0, 1),
      damp:     rRange(rng, 0.2, 0.9),
      mix:      mode === 'safe' ? rRange(rng, 0.05, 0.35) : rRange(rng, 0, 0.7),
    },
    delay: {
      enabled:  rBool(rng, 0.4),
      time:     rPick(rng, mode === 'safe'
        ? [0.125, 0.25, 0.375, 0.5, 0.75]
        : [0.05, 0.125, 0.25, 0.333, 0.375, 0.5, 0.666, 0.75, 1]),
      feedback: mode === 'safe' ? rRange(rng, 0.1, 0.55) : rRange(rng, 0, 0.9),
      mix:      mode === 'safe' ? rRange(rng, 0.1, 0.35) : rRange(rng, 0, 0.6),
      sync:     false,
    },
    chorus: {
      enabled:  rBool(rng, 0.4),
      rate:     mode === 'safe' ? rRange(rng, 0.1, 2)  : rRange(rng, 0.05, 8),
      depth:    mode === 'safe' ? rRange(rng, 0.1, 0.4) : rRange(rng, 0, 1),
      mix:      mode === 'safe' ? rRange(rng, 0.1, 0.4) : rRange(rng, 0, 0.8),
    },
    dist: {
      enabled:  rBool(rng, mode === 'safe' ? 0.2 : 0.4),
      drive:    mode === 'safe' ? rRange(rng, 0.5, 3)  : rRange(rng, 0, 10),
      tone:     rRange(rng, 0.2, 0.8),
      mix:      mode === 'safe' ? rRange(rng, 0.1, 0.4) : rRange(rng, 0, 0.8),
      mode:     rPick(rng, ['soft', 'soft', 'hard', 'bit'] as const),
    },
    eq: {
      enabled:  rBool(rng, 0.5),
      low:      mode === 'safe' ? rRange(rng, -6, 6)   : rRange(rng, -18, 18),
      mid:      mode === 'safe' ? rRange(rng, -6, 6)   : rRange(rng, -18, 18),
      high:     mode === 'safe' ? rRange(rng, -6, 6)   : rRange(rng, -18, 18),
      midFreq:  rPick(rng, [200, 400, 600, 800, 1000, 1500, 2000, 3000, 4000]),
    },
  };
}

export function randomLfo(ctx: RandomContext): LfoParams {
  const { rng, mode } = ctx;
  const shapes: LfoShape[] = ['sine', 'triangle', 'sawtooth', 'square', 'random'];
  return {
    shape: rPick(rng, mode === 'safe' ? ['sine', 'sine', 'triangle'] as LfoShape[] : shapes),
    rate:  mode === 'safe' ? rRange(rng, 0.1, 8) : rRange(rng, 0.01, 20),
    depth: mode === 'safe' ? rRange(rng, 0, 0.5) : rRange(rng, 0, 1),
    delay: mode === 'safe' ? rRange(rng, 0, 0.5) : rRange(rng, 0, 2),
    sync:  rBool(rng, 0.6),
    swing: mode === 'safe' ? rRange(rng, 0, 0.3) : rRange(rng, 0, 0.7),
  };
}

export function randomAlgorithm(ctx: RandomContext): number {
  const { rng, mode } = ctx;
  // Safe mode: bias towards algorithms with ≥2 carriers (richer sound)
  const safeAlgos = ALGORITHMS.filter(a => a.carriers.length >= 2).map(a => a.id);
  return mode === 'safe' ? rPick(rng, safeAlgos) : rPick(rng, ALGORITHMS.map(a => a.id));
}

// ── Whole-patch randomiser ─────────────────────────────────────────────────
export function randomPatch(seed: string | number, mode: RandomMode): PatchParams {
  const ctx = rc(seed, mode);
  const algorithm = randomAlgorithm(ctx);
  return {
    ...DEFAULT_PATCH,
    name:      `Random ${seed}`,
    author:    'CW Synth',
    tags:      ['random'],
    algorithm,
    operators: Array.from({ length: 6 }, (_, i) => randomOperator(rc(seed, mode), i)),
    filter:    randomFilter(rc(seed, mode)),
    lfo1:      randomLfo(rc(seed, mode)),
    lfo2:      randomLfo(rc(seed + '_lfo2', mode)),
    fx:        randomFx(rc(seed, mode)),
    volume:    mode === 'safe' ? 0.7 : rRange(rc(seed, mode).rng, 0.4, 0.9),
  };
}

// ── Per-section randomisers (operate on existing patch) ───────────────────
export function randomiseOperators(
  _patch: PatchParams, seed: string | number, mode: RandomMode
): Partial<PatchParams> {
  return {
    operators: Array.from({ length: 6 }, (_, i) =>
      randomOperator(rc(`${seed}_op${i}`, mode), i)
    ),
  };
}

export function randomiseAlgorithm(
  _patch: PatchParams, seed: string | number, mode: RandomMode
): Partial<PatchParams> {
  return { algorithm: randomAlgorithm(rc(seed, mode)) };
}

export function randomiseFilter(
  _patch: PatchParams, seed: string | number, mode: RandomMode
): Partial<PatchParams> {
  return { filter: randomFilter(rc(seed, mode)) };
}

export function randomiseFx(
  _patch: PatchParams, seed: string | number, mode: RandomMode
): Partial<PatchParams> {
  return { fx: randomFx(rc(seed, mode)) };
}

export function randomiseArp(
  _patch: PatchParams, seed: string | number, mode: RandomMode
): { rate: number; gate: number; octaves: number; pattern: string } {
  const { rng } = rc(seed, mode);
  return {
    rate:    mode === 'safe' ? rPick(rng, [2, 4, 6, 8, 12, 16]) : rRange(rng, 0.5, 20),
    gate:    mode === 'safe' ? rRange(rng, 0.3, 0.85) : rRange(rng, 0.05, 0.99),
    octaves: rPick(rng, [1, 1, 2, 2, 3, 4]),
    pattern: rPick(rng, ['up', 'down', 'updown', 'random']),
  };
}

// ── Seed generation ────────────────────────────────────────────────────────
export function generateSeed(): number {
  return Math.floor(Math.random() * 999999) + 1;
}
