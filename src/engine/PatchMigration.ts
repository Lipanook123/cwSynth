// Loading patches from untrusted JSON (.cwsyn files, localStorage) and
// upgrading v1 patches to the v2 schema.
//
// The old loader was `{ ...DEFAULT_PATCH, ...JSON.parse(text) }`. A shallow
// spread replaces whole nested objects, so a patch that specified only
// `fx.reverb` silently lost the other four FX sections, and any LFO written
// before `swing` existed produced `swing: undefined` — which crashed note-on
// in Lfo.start(). Everything here exists to make partial patches safe.

import {
  type PatchParams, type OperatorParams, type FilterParams, type LfoParams,
  type FxParams, type ModSlot, type Route, type UnisonParams,
  DEFAULT_PATCH, DEFAULT_OPERATOR, DEFAULT_FILTER, DEFAULT_LFO, DEFAULT_FX,
  DEFAULT_UNISON, PATCH_VERSION,
} from './Types';
import { type EnvParams, type EnvStage, DEFAULT_ENV, adsrToEnv } from './Envelope';

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function str<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : fallback;
}

// ── Envelopes ──────────────────────────────────────────────────────────────

function mergeStage(raw: unknown, fallback: EnvStage): EnvStage {
  if (!isObj(raw)) return { ...fallback };
  return {
    time:  Math.max(0, num(raw.time, fallback.time)),
    level: num(raw.level, fallback.level),
    curve: str(raw.curve, ['lin', 'exp'] as const, fallback.curve),
  };
}

function mergeEnv(raw: unknown, fallback: EnvParams): EnvParams {
  if (!isObj(raw)) return { ...fallback, stages: [...fallback.stages], release: [...fallback.release] };

  const stages = Array.isArray(raw.stages) && raw.stages.length
    ? raw.stages.map((s, i) => mergeStage(s, fallback.stages[i] ?? DEFAULT_ENV.stages[0]))
    : fallback.stages.map(s => ({ ...s }));

  const release = Array.isArray(raw.release) && raw.release.length
    ? raw.release.map((s, i) => mergeStage(s, fallback.release[i] ?? DEFAULT_ENV.release[0]))
    : fallback.release.map(s => ({ ...s }));

  return {
    stages,
    release,
    // -1 (one-shot) is meaningful, so clamp against the stage count rather than rejecting it.
    sustainStage: Math.min(num(raw.sustainStage, fallback.sustainStage), stages.length - 1),
    velSens:       num(raw.velSens, fallback.velSens),
    keyRateScale:  num(raw.keyRateScale, fallback.keyRateScale),
    keyLevelScale: num(raw.keyLevelScale, fallback.keyLevelScale),
  };
}

/** v1 stored flat attack/decay/sustain/release. Fold them into an EnvParams. */
function envFromV1(raw: Raw, fallback: EnvParams): EnvParams {
  const hasAdsr = 'attack' in raw || 'decay' in raw || 'sustain' in raw || 'release' in raw;
  if (!hasAdsr) return mergeEnv(raw.env, fallback);

  // `release` is a number in v1 and an array in v2 — only treat it as v1 ADSR
  // when it's actually a number, so a half-migrated patch can't confuse the two.
  const releaseTime = typeof raw.release === 'number' ? raw.release : 0.3;
  return adsrToEnv(
    num(raw.attack, 0.001),
    num(raw.decay, 0.3),
    num(raw.sustain, 0.5),
    releaseTime,
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

const WAVES = ['sine', 'triangle', 'sawtooth', 'square', 'wavetable'] as const;
const ROLES = ['fm', 'vco', 'noise', 'wavetable', 'pcm'] as const;
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'] as const;
const FILTER_MODELS = ['biquad', 'ladder', 'svf'] as const;
const NOISE_TYPES = ['white', 'pink'] as const;
const LFO_SHAPES = ['sine', 'triangle', 'sawtooth', 'square', 'random'] as const;
const DIST_MODES = ['soft', 'hard', 'bit'] as const;
const ROUTE_KINDS = ['fm', 'am', 'ring', 'sync', 'mix'] as const;

function mergeOperator(raw: unknown, fallback: OperatorParams): OperatorParams {
  if (!isObj(raw)) return { ...fallback, env: { ...fallback.env } };
  return {
    enabled:       bool(raw.enabled, fallback.enabled),
    role:          str(raw.role, ROLES, fallback.role),
    wave:          str(raw.wave, WAVES, fallback.wave),
    wavetableData: Array.isArray(raw.wavetableData) ? raw.wavetableData as number[] : fallback.wavetableData,
    ratio:         num(raw.ratio, fallback.ratio),
    fine:          num(raw.fine, fallback.fine),
    fixed:         bool(raw.fixed, fallback.fixed),
    fixedFreq:     num(raw.fixedFreq, fallback.fixedFreq),
    level:         num(raw.level, fallback.level),
    feedback:      num(raw.feedback, fallback.feedback),
    env:           envFromV1(raw, fallback.env),
    karplusStrong: bool(raw.karplusStrong, fallback.karplusStrong),
    ksDecay:       num(raw.ksDecay, fallback.ksDecay),
    pulseWidth:    num(raw.pulseWidth, fallback.pulseWidth),
    drift:         num(raw.drift, fallback.drift),
    noiseType:     str(raw.noiseType, NOISE_TYPES, fallback.noiseType),
  };
}

function mergeFilter(raw: unknown, fallback: FilterParams): FilterParams {
  if (!isObj(raw)) return { ...fallback, env: { ...fallback.env } };
  return {
    enabled:    bool(raw.enabled, fallback.enabled),
    model:      str(raw.model, FILTER_MODELS, fallback.model),
    type:       str(raw.type, FILTER_TYPES, fallback.type),
    cutoff:     num(raw.cutoff, fallback.cutoff),
    resonance:  num(raw.resonance, fallback.resonance),
    slope:      num(raw.slope, fallback.slope) < 18 ? 12 : 24,
    drive:      num(raw.drive, fallback.drive),
    hpfCutoff:  num(raw.hpfCutoff, fallback.hpfCutoff),
    envAmount:  num(raw.envAmount, fallback.envAmount),
    env:        envFromV1(raw, fallback.env),
    keytrack:   num(raw.keytrack, fallback.keytrack),
  };
}

function mergeLfo(raw: unknown, fallback: LfoParams): LfoParams {
  if (!isObj(raw)) return { ...fallback };
  return {
    shape: str(raw.shape, LFO_SHAPES, fallback.shape),
    rate:  num(raw.rate, fallback.rate),
    depth: num(raw.depth, fallback.depth),
    delay: num(raw.delay, fallback.delay),
    sync:  bool(raw.sync, fallback.sync),
    swing: num(raw.swing, fallback.swing),   // the field whose absence used to crash note-on
  };
}

function mergeFx(raw: unknown, fallback: FxParams): FxParams {
  if (!isObj(raw)) return structuredClone(fallback);
  const rv = isObj(raw.reverb) ? raw.reverb : {};
  const dl = isObj(raw.delay)  ? raw.delay  : {};
  const ch = isObj(raw.chorus) ? raw.chorus : {};
  const ds = isObj(raw.dist)   ? raw.dist   : {};
  const eq = isObj(raw.eq)     ? raw.eq     : {};
  return {
    reverb: {
      enabled: bool(rv.enabled, fallback.reverb.enabled),
      size:    num(rv.size, fallback.reverb.size),
      damp:    num(rv.damp, fallback.reverb.damp),
      mix:     num(rv.mix, fallback.reverb.mix),
    },
    delay: {
      enabled:  bool(dl.enabled, fallback.delay.enabled),
      time:     num(dl.time, fallback.delay.time),
      feedback: num(dl.feedback, fallback.delay.feedback),
      mix:      num(dl.mix, fallback.delay.mix),
      sync:     bool(dl.sync, fallback.delay.sync),
    },
    chorus: {
      enabled: bool(ch.enabled, fallback.chorus.enabled),
      rate:    num(ch.rate, fallback.chorus.rate),
      depth:   num(ch.depth, fallback.chorus.depth),
      mix:     num(ch.mix, fallback.chorus.mix),
    },
    dist: {
      enabled: bool(ds.enabled, fallback.dist.enabled),
      drive:   num(ds.drive, fallback.dist.drive),
      tone:    num(ds.tone, fallback.dist.tone),
      mix:     num(ds.mix, fallback.dist.mix),
      mode:    str(ds.mode, DIST_MODES, fallback.dist.mode),
    },
    eq: {
      enabled: bool(eq.enabled, fallback.eq.enabled),
      low:     num(eq.low, fallback.eq.low),
      mid:     num(eq.mid, fallback.eq.mid),
      high:    num(eq.high, fallback.eq.high),
      midFreq: num(eq.midFreq, fallback.eq.midFreq),
    },
  };
}

function mergeUnison(raw: unknown, fallback: UnisonParams): UnisonParams {
  if (!isObj(raw)) return { ...fallback };
  return {
    voices: Math.max(1, Math.round(num(raw.voices, fallback.voices))),
    detune: num(raw.detune, fallback.detune),
    spread: num(raw.spread, fallback.spread),
  };
}

function mergeModMatrix(raw: unknown): ModSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map(s => ({
    source:  s.source as ModSlot['source'],
    dest:    s.dest as ModSlot['dest'],
    amount:  num(s.amount, 0),
    enabled: bool(s.enabled, true),
  })).filter(s => typeof s.source === 'string' && typeof s.dest === 'string');
}

function mergeRoutes(raw: unknown): Route[] | null {
  if (!Array.isArray(raw)) return null;
  const routes = raw.filter(isObj).map(r => ({
    from:   num(r.from, 0),
    to:     r.to === 'out' ? 'out' as const : num(r.to, 0),
    kind:   str(r.kind, ROUTE_KINDS, 'fm' as const),
    amount: num(r.amount, 1),
  }));
  return routes.length ? routes : null;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Turn arbitrary parsed JSON into a valid PatchParams, upgrading v1 to v2 on
 * the way. Every field is defaulted, so a `{}` input yields DEFAULT_PATCH and
 * a partial input keeps whatever it did specify.
 */
export function normalisePatch(raw: unknown): PatchParams {
  const p: Raw = isObj(raw) ? raw : {};

  const rawOps = Array.isArray(p.operators) ? p.operators : [];
  const operators = Array.from({ length: 6 }, (_, i) =>
    mergeOperator(rawOps[i], DEFAULT_PATCH.operators[i] ?? DEFAULT_OPERATOR),
  );

  return {
    name:      typeof p.name === 'string' ? p.name : DEFAULT_PATCH.name,
    author:    typeof p.author === 'string' ? p.author : DEFAULT_PATCH.author,
    tags:      Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    version:   PATCH_VERSION,
    algorithm: Math.min(32, Math.max(1, Math.round(num(p.algorithm, DEFAULT_PATCH.algorithm)))),
    routes:    mergeRoutes(p.routes),
    operators,
    filter:    mergeFilter(p.filter, DEFAULT_FILTER),
    lfo1:      mergeLfo(p.lfo1, DEFAULT_LFO),
    lfo2:      mergeLfo(p.lfo2, DEFAULT_PATCH.lfo2),
    modMatrix: mergeModMatrix(p.modMatrix),
    fx:        mergeFx(p.fx, DEFAULT_FX),
    polyphony: Math.max(1, Math.round(num(p.polyphony, DEFAULT_PATCH.polyphony))),
    glide:     Math.max(0, num(p.glide, DEFAULT_PATCH.glide)),
    unison:    mergeUnison(p.unison, DEFAULT_UNISON),
    pitchBend: num(p.pitchBend, DEFAULT_PATCH.pitchBend),
    transpose: num(p.transpose, DEFAULT_PATCH.transpose),
    volume:    num(p.volume, DEFAULT_PATCH.volume),
  };
}

/** True if the raw JSON predates the v2 schema (flat ADSR on operators). */
export function isV1Patch(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  if (num(raw.version, 1) >= 2) return false;
  const ops = raw.operators;
  return Array.isArray(ops) && ops.some(o => isObj(o) && typeof o.attack === 'number');
}
