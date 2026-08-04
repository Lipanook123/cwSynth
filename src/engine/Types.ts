import { type EnvParams, DEFAULT_ENV, adsrToEnv } from './Envelope';

export type { EnvParams, EnvStage, EnvCurve } from './Envelope';

export const PATCH_VERSION = 2;

export type WaveType = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'wavetable';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
/** Filter character. `biquad` is the stock Web Audio node; the others are worklets. */
export type FilterModel = 'biquad' | 'ladder' | 'svf';
export type NoiseType = 'white' | 'pink';

/**
 * How notes are allocated.
 * - `poly`   — a voice per note, up to `polyphony`
 * - `mono`   — one voice; every new note retriggers the envelopes
 * - `legato` — one voice; overlapping notes glide without retriggering
 */
export type VoiceMode = 'poly' | 'mono' | 'legato';

/** Which held note wins in mono/legato when several are down. */
export type NotePriority = 'last' | 'low' | 'high';
export type LfoShape = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'random';
export type ModSource = 'lfo1' | 'lfo2' | 'env1' | 'env2' | 'env3' | 'env4' | 'env5' | 'env6' | 'velocity' | 'mod';
export type ModDest =
  | 'op1_level' | 'op2_level' | 'op3_level' | 'op4_level' | 'op5_level' | 'op6_level'
  | 'op1_ratio' | 'op2_ratio' | 'op3_ratio' | 'op4_ratio' | 'op5_ratio' | 'op6_ratio'
  | 'filter_cutoff' | 'filter_res' | 'pitch' | 'fx_reverb' | 'fx_delay' | 'fx_chorus' | 'amp';

/**
 * What an operator *is*. Operators are the universal primitive: the same six
 * slots become DX-7 FM operators, Minimoog VCOs, an ESQ-1 wavetable DCO, or a
 * D-50 PCM attack transient depending on this field.
 *
 * `fm`, `vco` and `noise` are implemented. `wavetable` and `pcm` are defined so
 * the schema did not need a second breaking change later; they currently behave
 * as `fm`.
 */
export type OpRole = 'fm' | 'vco' | 'noise' | 'wavetable' | 'pcm';

export interface OperatorParams {
  enabled: boolean;
  role: OpRole;
  wave: WaveType;
  wavetableData: number[] | null; // normalised -1..1, 2048 samples
  ratio: number;       // coarse ratio (0.5–16)
  fine: number;        // fine detune cents (-100..100)
  fixed: boolean;      // fixed freq mode
  fixedFreq: number;   // Hz when fixed
  level: number;       // 0..1 — carrier amplitude, or FM index when modulating
  feedback: number;    // 0..1 self-feedback
  env: EnvParams;
  karplusStrong: boolean;
  ksDecay: number;     // KS decay factor 0..1
  /** Pulse width for `vco` role with a square/pulse wave. 0.5 = square. */
  pulseWidth: number;
  /** 0..1 analog pitch instability. Stops stacked voices sounding identical. */
  drift: number;
  /** Noise colour for the `noise` role. */
  noiseType: NoiseType;
}

export interface FilterParams {
  enabled: boolean;
  model: FilterModel;
  type: FilterType;
  cutoff: number;      // Hz
  /**
   * Meaning depends on `model`: biquad reads it as Q (0..30), while ladder and
   * svf normalise it to 0..1 where 1 self-oscillates. Voice maps between them.
   */
  resonance: number;
  slope: 12 | 24;      // ladder/svf only
  drive: number;       // 0..1 input saturation, ladder/svf only
  hpfCutoff: number;   // series non-resonant highpass; 20 = off (Jupiter-8 topology)
  envAmount: number;   // -1..1 (maps cutoff by ±4 octaves)
  env: EnvParams;
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

/** How one operator feeds another (or the output). See Algorithms.ts. */
export type RouteKind = 'fm' | 'am' | 'ring' | 'sync' | 'mix';

export interface Route {
  from: number;             // operator index 0-5
  to: number | 'out';       // target operator index, or the voice output
  kind: RouteKind;
  amount: number;           // 0..1 multiplier on top of the source operator's level
}

/** Voice allocation. Minimoog-style mono needs glide + note priority; poly needs a ceiling. */
export interface UnisonParams {
  voices: number;      // 1 = off
  detune: number;      // cents of spread across the stack
  spread: number;      // 0..1 stereo spread
}

export interface PatchParams {
  name: string;
  author: string;
  tags: string[];
  version: number;
  algorithm: number;   // 1..32
  routes: Route[] | null;  // custom routing; null = derive from `algorithm`
  operators: OperatorParams[];
  filter: FilterParams;
  lfo1: LfoParams;
  lfo2: LfoParams;
  modMatrix: ModSlot[];
  fx: FxParams;
  polyphony: number;   // max simultaneous voices
  voiceMode: VoiceMode;
  notePriority: NotePriority;
  glide: number;       // portamento time in seconds (0 = off)
  unison: UnisonParams;
  pitchBend: number;   // semitones range
  transpose: number;   // semitones
  volume: number;      // 0..1
}

export const DEFAULT_OPERATOR: OperatorParams = {
  enabled: true,
  role: 'fm',
  wave: 'sine',
  wavetableData: null,
  ratio: 1,
  fine: 0,
  fixed: false,
  fixedFreq: 440,
  level: 0.8,
  feedback: 0,
  env: DEFAULT_ENV,
  karplusStrong: false,
  ksDecay: 0.995,
  pulseWidth: 0.5,
  drift: 0,
  noiseType: 'white',
};

export const DEFAULT_FILTER: FilterParams = {
  enabled: false,
  // Defaults to the stock biquad so every patch written before the worklets
  // existed sounds exactly as it did. Analog templates opt into 'ladder'.
  model: 'biquad',
  type: 'lowpass',
  cutoff: 4000,
  resonance: 1,
  slope: 24,
  drive: 0,
  hpfCutoff: 20,
  envAmount: 0.5,
  env: adsrToEnv(0.01, 0.3, 0, 0.2),
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

export const DEFAULT_UNISON: UnisonParams = {
  voices: 1,
  detune: 8,
  spread: 0.5,
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
  version: PATCH_VERSION,
  algorithm: 1,
  routes: null,
  operators: Array.from({ length: 6 }, (_, i) => ({
    ...DEFAULT_OPERATOR,
    env: adsrToEnv(0.001, 0.3, 0.5, 0.3),
    level: i === 0 ? 1 : 0.8,
  })),
  filter: DEFAULT_FILTER,
  lfo1: DEFAULT_LFO,
  lfo2: { ...DEFAULT_LFO, rate: 0.3 },
  modMatrix: [],
  fx: DEFAULT_FX,
  polyphony: 16,
  voiceMode: 'poly',
  notePriority: 'last',
  glide: 0,
  unison: DEFAULT_UNISON,
  pitchBend: 2,
  transpose: 0,
  volume: 0.7,
};
