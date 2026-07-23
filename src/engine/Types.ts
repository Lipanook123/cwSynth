export type WaveType = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'wavetable';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
export type LfoShape = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'random';
export type ModSource = 'lfo1' | 'lfo2' | 'env1' | 'env2' | 'env3' | 'env4' | 'env5' | 'env6' | 'velocity' | 'mod';
export type ModDest =
  | 'op1_level' | 'op2_level' | 'op3_level' | 'op4_level' | 'op5_level' | 'op6_level'
  | 'op1_ratio' | 'op2_ratio' | 'op3_ratio' | 'op4_ratio' | 'op5_ratio' | 'op6_ratio'
  | 'filter_cutoff' | 'filter_res' | 'pitch' | 'fx_reverb' | 'fx_delay' | 'fx_chorus' | 'amp';

export interface OperatorParams {
  enabled: boolean;
  wave: WaveType;
  wavetableData: number[] | null; // normalised -1..1, 2048 samples
  ratio: number;       // coarse ratio (0.5–16)
  fine: number;        // fine detune cents (-100..100)
  fixed: boolean;      // fixed freq mode
  fixedFreq: number;   // Hz when fixed
  level: number;       // 0..1
  feedback: number;    // 0..1 self-feedback
  attack: number;      // s
  decay: number;       // s
  sustain: number;     // 0..1
  release: number;     // s
  karplusStrong: boolean;
  ksDecay: number;     // KS decay factor 0..1
}

export interface FilterParams {
  enabled: boolean;
  type: FilterType;
  cutoff: number;      // Hz
  resonance: number;   // 0..30
  envAmount: number;   // -1..1 (maps cutoff by ±4 octaves)
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  keytrack: number;    // 0..1
}

export interface LfoParams {
  shape: LfoShape;
  rate: number;        // Hz
  depth: number;       // 0..1 (interpreted per-destination)
  delay: number;       // s before onset
  sync: boolean;       // retrigger on note-on
  swing: number;       // 0 = even, 1 = max shuffle (2:1 half-cycle ratio)
}

export interface ModSlot {
  source: ModSource;
  dest: ModDest;
  amount: number;      // -1..1
  enabled: boolean;
}

export interface FxParams {
  reverb:  { enabled: boolean; size: number; damp: number; mix: number };
  delay:   { enabled: boolean; time: number; feedback: number; mix: number; sync: boolean };
  chorus:  { enabled: boolean; rate: number; depth: number; mix: number };
  dist:    { enabled: boolean; drive: number; tone: number; mix: number; mode: 'soft'|'hard'|'bit' };
  eq:      { enabled: boolean; low: number; mid: number; high: number; midFreq: number };
}

export interface PatchParams {
  name: string;
  author: string;
  tags: string[];
  version: number;
  algorithm: number;   // 1..32
  operators: OperatorParams[];
  filter: FilterParams;
  lfo1: LfoParams;
  lfo2: LfoParams;
  modMatrix: ModSlot[];
  fx: FxParams;
  pitchBend: number;   // semitones range
  transpose: number;   // semitones
  volume: number;      // 0..1
}

export const DEFAULT_OPERATOR: OperatorParams = {
  enabled: true,
  wave: 'sine',
  wavetableData: null,
  ratio: 1,
  fine: 0,
  fixed: false,
  fixedFreq: 440,
  level: 0.8,
  feedback: 0,
  attack: 0.001,
  decay: 0.3,
  sustain: 0.5,
  release: 0.3,
  karplusStrong: false,
  ksDecay: 0.995,
};

export const DEFAULT_FILTER: FilterParams = {
  enabled: false,
  type: 'lowpass',
  cutoff: 4000,
  resonance: 1,
  envAmount: 0.5,
  attack: 0.01,
  decay: 0.3,
  sustain: 0,
  release: 0.2,
  keytrack: 0.5,
};

export const DEFAULT_LFO: LfoParams = {
  shape: 'sine',
  rate: 5,
  depth: 0.3,
  delay: 0.2,
  sync: true,
  swing: 0,
};

export const DEFAULT_FX: FxParams = {
  reverb: { enabled: false, size: 0.6, damp: 0.5, mix: 0.25 },
  delay:  { enabled: false, time: 0.375, feedback: 0.4, mix: 0.25, sync: false },
  chorus: { enabled: false, rate: 0.5, depth: 0.3, mix: 0.4 },
  dist:   { enabled: false, drive: 2, tone: 0.5, mix: 0.5, mode: 'soft' },
  eq:     { enabled: false, low: 0, mid: 0, high: 0, midFreq: 1000 },
};

export const DEFAULT_PATCH: PatchParams = {
  name: 'Untitled',
  author: '',
  tags: [],
  version: 1,
  algorithm: 1,
  operators: Array.from({ length: 6 }, (_, i) => ({
    ...DEFAULT_OPERATOR,
    level: i === 0 ? 1 : 0.8,
  })),
  filter: DEFAULT_FILTER,
  lfo1: DEFAULT_LFO,
  lfo2: { ...DEFAULT_LFO, rate: 0.3 },
  modMatrix: [],
  fx: DEFAULT_FX,
  pitchBend: 2,
  transpose: 0,
  volume: 0.7,
};
