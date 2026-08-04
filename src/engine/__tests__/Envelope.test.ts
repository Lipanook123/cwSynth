import { describe, it, expect } from 'vitest';
import {
  adsrToEnv, envToAdsr, isAdsrShaped, scheduleEnvelope, scheduleRelease,
  releaseDuration, envDuration, rateScaleFactor, levelScaleFactor, envPeak,
  type EnvParams,
} from '../Envelope';

/** Records the AudioParam automation calls the envelope scheduler makes. */
function fakeParam() {
  const calls: { fn: string; value: number; time: number; extra?: number }[] = [];
  return {
    calls,
    value: 0,
    cancelScheduledValues(t: number) { calls.push({ fn: 'cancel', value: 0, time: t }); },
    setValueAtTime(v: number, t: number) { calls.push({ fn: 'set', value: v, time: t }); },
    linearRampToValueAtTime(v: number, t: number) { calls.push({ fn: 'linear', value: v, time: t }); },
    setTargetAtTime(v: number, t: number, tau: number) { calls.push({ fn: 'target', value: v, time: t, extra: tau }); },
  } as unknown as AudioParam & { calls: { fn: string; value: number; time: number; extra?: number }[] };
}

describe('adsrToEnv / envToAdsr', () => {
  it('round-trips ADSR values', () => {
    const env = adsrToEnv(0.01, 0.4, 0.6, 0.25);
    expect(envToAdsr(env)).toEqual({ attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.25 });
  });

  it('marks ADSR-shaped envelopes', () => {
    expect(isAdsrShaped(adsrToEnv(0.01, 0.4, 0.6, 0.25))).toBe(true);
  });

  it('does not treat a 3-stage envelope as ADSR', () => {
    const env: EnvParams = {
      ...adsrToEnv(0.01, 0.4, 0.6, 0.25),
      stages: [
        { time: 0.01, level: 1, curve: 'lin' },
        { time: 0.1, level: 0.8, curve: 'exp' },
        { time: 0.3, level: 0.5, curve: 'exp' },
      ],
      sustainStage: 2,
    };
    expect(isAdsrShaped(env)).toBe(false);
    expect(envToAdsr(env)).toBeNull();
  });

  it('carries velocity and scaling options through', () => {
    const env = adsrToEnv(0.01, 0.4, 0.6, 0.25, { velSens: 0.8, keyRateScale: 0.5 });
    expect(env.velSens).toBe(0.8);
    expect(env.keyRateScale).toBe(0.5);
  });
});

describe('scheduleEnvelope', () => {
  it('stops at the sustain stage and holds', () => {
    const p = fakeParam();
    const end = scheduleEnvelope(p, adsrToEnv(0.1, 0.2, 0.5, 0.3), 1, 1, 1, 60);
    // attack (0.1) + decay (0.2), then hold — release is not scheduled here.
    expect(end).toBeCloseTo(1.3, 6);
    expect(p.calls.some(c => c.fn === 'cancel')).toBe(true);
    expect(p.calls[1]).toMatchObject({ fn: 'set', value: 0, time: 1 });
  });

  it('runs every stage when sustainStage is -1 (one-shot)', () => {
    const env: EnvParams = { ...adsrToEnv(0.1, 0.2, 0.5, 0.3), sustainStage: -1 };
    const p = fakeParam();
    const end = scheduleEnvelope(p, env, 0, 1, 1, 60);
    expect(end).toBeCloseTo(0.3, 6);
  });

  it('scales the peak by velocity only as far as velSens allows', () => {
    const env = adsrToEnv(0.1, 0.2, 1, 0.3, { velSens: 0.5 });
    const p = fakeParam();
    scheduleEnvelope(p, env, 0, 1, 0, 60);
    // velSens 0.5 at velocity 0 → half the peak, not silence.
    const attackPeak = p.calls.find(c => c.fn === 'linear');
    expect(attackPeak?.value).toBeCloseTo(0.5, 6);
  });

  it('ignores velocity entirely when velSens is 0', () => {
    const p = fakeParam();
    scheduleEnvelope(p, adsrToEnv(0.1, 0.2, 1, 0.3), 0, 1, 0.1, 60);
    expect(p.calls.find(c => c.fn === 'linear')?.value).toBeCloseTo(1, 6);
  });

  it('uses setTargetAtTime for exp stages and pins the final value', () => {
    const p = fakeParam();
    scheduleEnvelope(p, adsrToEnv(0.1, 0.2, 0.5, 0.3), 0, 1, 1, 60);
    const target = p.calls.find(c => c.fn === 'target');
    expect(target).toBeDefined();
    expect(target!.value).toBeCloseTo(0.5, 6);
    // Pinned at the stage boundary, because setTargetAtTime never arrives.
    expect(p.calls.some(c => c.fn === 'set' && Math.abs(c.time - 0.3) < 1e-9)).toBe(true);
  });
});

describe('scheduleRelease', () => {
  it('returns the time the release finishes', () => {
    const p = fakeParam();
    const end = scheduleRelease(p, adsrToEnv(0.01, 0.2, 0.5, 0.4), 2, 1, 1, 60);
    expect(end).toBeCloseTo(2.4, 6);
  });
});

describe('key scaling', () => {
  it('is a no-op at the default note when scaling is off', () => {
    const env = adsrToEnv(0.01, 0.2, 0.5, 0.3);
    expect(rateScaleFactor(env, 84)).toBe(1);
    expect(levelScaleFactor(env, 84)).toBe(1);
  });

  it('halves envelope duration an octave up at full rate scaling', () => {
    const env = adsrToEnv(0.01, 0.2, 0.5, 0.3, { keyRateScale: 1 });
    expect(rateScaleFactor(env, 72)).toBeCloseTo(0.5, 6);
    expect(rateScaleFactor(env, 48)).toBeCloseTo(2, 6);
  });

  it('shortens the release for high notes', () => {
    const env = adsrToEnv(0.01, 0.2, 0.5, 0.4, { keyRateScale: 1 });
    expect(releaseDuration(env, 72)).toBeCloseTo(0.2, 6);
    expect(releaseDuration(env, 60)).toBeCloseTo(0.4, 6);
  });

  it('never lets level scaling go negative', () => {
    const env = adsrToEnv(0.01, 0.2, 0.5, 0.3, { keyLevelScale: -1 });
    expect(levelScaleFactor(env, 127)).toBeGreaterThanOrEqual(0);
    expect(envPeak(env, 1, 1, 127)).toBeGreaterThanOrEqual(0);
  });
});

describe('envDuration', () => {
  it('sums every stage plus release', () => {
    expect(envDuration(adsrToEnv(0.1, 0.2, 0.5, 0.4))).toBeCloseTo(0.7, 6);
  });
});
