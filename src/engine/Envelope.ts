// N-stage rate/level envelope generator.
//
// Replaces the flat ADSR that used to live on OperatorParams/FilterParams.
// Both shapes we care about are expressible here:
//
//   ADSR    → stages [{A,1},{D,S}], sustainStage 1, release [{R,0}]
//   DX-7 EG → stages [{R1,L1},{R2,L2},{R3,L3}], sustainStage 2, release [{R4,L4}]
//
// Stage `time` is the duration of that stage; `level` is the value reached at
// its end. `curve: 'exp'` approaches the target asymptotically (setTargetAtTime)
// which is what gives envelopes their analog feel — linear ramps are the reason
// the old engine sounded synthetic on decays.

export type EnvCurve = 'lin' | 'exp';

export interface EnvStage {
  time: number;   // seconds, duration of this stage
  level: number;  // 0..1, value at the end of this stage
  curve: EnvCurve;
}

export interface EnvParams {
  stages: EnvStage[];
  sustainStage: number;   // index of the stage held while key is down; -1 = one-shot
  release: EnvStage[];
  velSens: number;        // 0..1 — how much velocity scales the envelope peak
  keyRateScale: number;   // 0..1 — higher notes run the envelope faster
  keyLevelScale: number;  // -1..1 — output level tilt across the keyboard
}

/** Envelope stages shorter than this are treated as instantaneous jumps. */
const MIN_STAGE = 0.0005;

/**
 * setTargetAtTime approaches its target asymptotically and never arrives, so a
 * stage of duration `t` uses a time constant of t/EXP_TAU_DIVISOR and is then
 * pinned to the exact target at the stage boundary. 3 time constants reaches
 * ~95% of the target, which reads as "arrived" while keeping the curved shape.
 */
const EXP_TAU_DIVISOR = 3;

export const DEFAULT_ENV: EnvParams = {
  stages: [
    { time: 0.001, level: 1,   curve: 'lin' },
    { time: 0.3,   level: 0.5, curve: 'exp' },
  ],
  sustainStage: 1,
  release: [{ time: 0.3, level: 0, curve: 'exp' }],
  velSens: 0,
  keyRateScale: 0,
  keyLevelScale: 0,
};

/** Build an ADSR-shaped envelope. Used by the v1→v2 migration and the simple UI editor. */
export function adsrToEnv(
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  opts: Partial<Pick<EnvParams, 'velSens' | 'keyRateScale' | 'keyLevelScale'>> = {},
): EnvParams {
  return {
    stages: [
      { time: attack, level: 1,       curve: 'lin' },
      { time: decay,  level: sustain, curve: 'exp' },
    ],
    sustainStage: 1,
    release: [{ time: release, level: 0, curve: 'exp' }],
    velSens: opts.velSens ?? 0,
    keyRateScale: opts.keyRateScale ?? 0,
    keyLevelScale: opts.keyLevelScale ?? 0,
  };
}

/**
 * True when the envelope still has the classic 2-stage + 1-release shape, so the
 * operator panel can show A/D/S/R knobs instead of the full rate/level grid.
 */
export function isAdsrShaped(env: EnvParams): boolean {
  return env.stages.length === 2
    && env.release.length === 1
    && env.sustainStage === 1
    && env.stages[0].level === 1
    && env.release[0].level === 0;
}

/** Read an ADSR-shaped envelope back out as A/D/S/R. Returns null for other shapes. */
export function envToAdsr(env: EnvParams): { attack: number; decay: number; sustain: number; release: number } | null {
  if (!isAdsrShaped(env)) return null;
  return {
    attack:  env.stages[0].time,
    decay:   env.stages[1].time,
    sustain: env.stages[1].level,
    release: env.release[0].time,
  };
}

/**
 * DX-7 rate scaling: higher notes run their envelopes faster. At keyRateScale 1
 * the envelope roughly halves in duration per octave above middle C, which
 * matches how the DX-7 keeps high notes from ringing longer than low ones.
 */
export function rateScaleFactor(env: EnvParams, semitone: number): number {
  if (!env.keyRateScale) return 1;
  return Math.pow(2, -env.keyRateScale * (semitone - 60) / 12);
}

/**
 * DX-7 level scaling: output level tilts across the keyboard. Positive depth
 * makes higher notes louder, negative makes them quieter (the usual choice, so
 * high modulators don't turn shrill).
 */
export function levelScaleFactor(env: EnvParams, semitone: number): number {
  if (!env.keyLevelScale) return 1;
  const octaves = (semitone - 60) / 12;
  return Math.max(0, Math.min(2, 1 + env.keyLevelScale * octaves * 0.5));
}

/** Peak value the envelope reaches, after velocity and key level scaling. */
export function envPeak(env: EnvParams, peak: number, velocity: number, semitone: number): number {
  const vel = 1 - env.velSens + env.velSens * velocity;
  return peak * vel * levelScaleFactor(env, semitone);
}

function rampTo(param: AudioParam, target: number, startTime: number, duration: number, curve: EnvCurve) {
  if (duration < MIN_STAGE) {
    param.setValueAtTime(target, startTime + duration);
    return;
  }
  if (curve === 'exp') {
    // setTargetAtTime cannot land exactly on the target, so pin it at the boundary.
    param.setTargetAtTime(target, startTime, duration / EXP_TAU_DIVISOR);
    param.setValueAtTime(target, startTime + duration);
  } else {
    param.linearRampToValueAtTime(target, startTime + duration);
  }
}

/**
 * Schedule the key-down portion of the envelope onto an AudioParam.
 *
 * Stages up to and including `sustainStage` are scheduled; the value then holds
 * until scheduleRelease is called. If sustainStage is -1 the envelope is
 * one-shot: every stage runs and the note decays to its final level on its own,
 * which is what percussive patches want.
 *
 * Returns the absolute time at which the scheduled portion finishes.
 */
export function scheduleEnvelope(
  param: AudioParam,
  env: EnvParams,
  t0: number,
  peak: number,
  velocity: number,
  semitone: number,
): number {
  const scale = rateScaleFactor(env, semitone);
  const top = envPeak(env, peak, velocity, semitone);

  param.cancelScheduledValues(t0);
  param.setValueAtTime(0, t0);

  const last = env.sustainStage < 0
    ? env.stages.length - 1
    : Math.min(env.sustainStage, env.stages.length - 1);

  let t = t0;
  for (let i = 0; i <= last; i++) {
    const st = env.stages[i];
    const dur = st.time * scale;
    rampTo(param, st.level * top, t, dur, st.curve);
    t += dur;
  }
  return t;
}

/**
 * Schedule the key-up portion. Starts from wherever the param currently is, so
 * releasing mid-attack doesn't jump.
 *
 * Returns the absolute time the envelope reaches its final level.
 */
export function scheduleRelease(
  param: AudioParam,
  env: EnvParams,
  time: number,
  peak: number,
  velocity: number,
  semitone: number,
): number {
  const scale = rateScaleFactor(env, semitone);
  const top = envPeak(env, peak, velocity, semitone);

  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);

  let t = time;
  for (const st of env.release) {
    const dur = st.time * scale;
    rampTo(param, st.level * top, t, dur, st.curve);
    t += dur;
  }
  return t;
}

/** Total release time, used to decide when a voice can be torn down. */
export function releaseDuration(env: EnvParams, semitone = 60): number {
  const scale = rateScaleFactor(env, semitone);
  return env.release.reduce((sum, st) => sum + st.time * scale, 0);
}

/** Total time for the whole envelope to run start to finish (one-shot length). */
export function envDuration(env: EnvParams, semitone = 60): number {
  const scale = rateScaleFactor(env, semitone);
  const attackish = env.stages.reduce((sum, st) => sum + st.time * scale, 0);
  return attackish + releaseDuration(env, semitone);
}
