import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installFakeAudio, FakeAudioWorkletNode, FakeBiquad, FakeParam } from './fakeAudio';
import { normalisePatch } from '../PatchMigration';
import { normaliseResonance } from '../VoiceFilter';
import type { PatchParams } from '../Types';

let restore: () => void;
let VoiceCls: typeof import('../Voice').Voice;
let VoiceFilterCls: typeof import('../VoiceFilter').VoiceFilter;
let loadWorkletsFn: typeof import('../worklets').loadWorklets;
let makeCtx: typeof import('./fakeAudio').makeCtx;

beforeAll(async () => {
  restore = installFakeAudio({ worklets: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  VoiceCls = (await import('../Voice')).Voice;
  VoiceFilterCls = (await import('../VoiceFilter')).VoiceFilter;
  loadWorkletsFn = (await import('../worklets')).loadWorklets;
  makeCtx = (await import('./fakeAudio')).makeCtx;
});

afterAll(() => restore?.());

/** A context with the worklet modules already registered. */
async function readyCtx(): Promise<AudioContext> {
  const ctx = makeCtx();
  await loadWorkletsFn(ctx);
  return ctx;
}

function analogPatch(over: Record<string, unknown> = {}): PatchParams {
  return normalisePatch({
    filter: { enabled: true, model: 'ladder', cutoff: 1200, resonance: 18, slope: 24, drive: 0.4 },
    operators: [
      { enabled: true, role: 'vco', wave: 'sawtooth', level: 0.9 },
      { enabled: true, role: 'vco', wave: 'square', level: 0.7, pulseWidth: 0.3, fine: 7 },
    ],
    algorithm: 16, // fully additive — both VCOs straight to the output
    ...over,
  });
}

describe('VoiceFilter model selection', () => {
  it('uses the worklet when the patch asks for a ladder and it is loaded', async () => {
    const ctx = await readyCtx();
    const f = new VoiceFilterCls(ctx, analogPatch().filter);
    expect(f.usingWorklet).toBe(true);
    expect(f.cutoffParam).toBeInstanceOf(FakeParam);
  });

  it('falls back to a biquad when worklets are not loaded', () => {
    // Deliberately not calling loadWorklets: this is the state during the first
    // few milliseconds after page load, and a patch must still make sound.
    const ctx = makeCtx();
    const f = new VoiceFilterCls(ctx, analogPatch().filter);
    expect(f.usingWorklet).toBe(false);
    expect(f.cutoffParam).toBeInstanceOf(FakeParam);
  });

  it('uses a biquad when the patch asks for one, even with worklets available', async () => {
    const ctx = await readyCtx();
    const f = new VoiceFilterCls(ctx, normalisePatch({ filter: { enabled: true } }).filter);
    expect(f.usingWorklet).toBe(false);
  });

  it('inserts a series highpass only when hpfCutoff is raised', async () => {
    const ctx = await readyCtx();
    const withHpf = new VoiceFilterCls(ctx, analogPatch({
      filter: { enabled: true, model: 'ladder', hpfCutoff: 200 },
    }).filter);
    const hpfNodes = withHpf.input.connections.filter(c => c.target instanceof FakeBiquad);
    expect(hpfNodes.length).toBe(1);

    const without = new VoiceFilterCls(ctx, analogPatch().filter);
    const noHpf = without.input.connections.filter(
      c => c.target instanceof FakeBiquad && (c.target as FakeBiquad).type === 'highpass',
    );
    expect(noHpf.length).toBe(0);
  });

  it('maps resonance onto the model in use', () => {
    // Patches store resonance on the biquad's 0..30 Q scale; the worklets want
    // 0..1. A mod slot has to mean the same musical amount on both.
    expect(normaliseResonance(30)).toBeCloseTo(1, 6);
    expect(normaliseResonance(15)).toBeCloseTo(0.5, 6);
    expect(normaliseResonance(0)).toBe(0);
    expect(normaliseResonance(999)).toBe(1);
  });
});

describe('VCO operators', () => {
  it('creates worklet oscillators for vco-role operators', async () => {
    const ctx = await readyCtx();
    const v = new VoiceCls(ctx, analogPatch(), 60, 261.63);
    v.noteOn(1, 0);
    const ops = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] }).operators;
    // A worklet frequency param still behaves as an AudioParam, which is what
    // keeps FM routing and pitch modulation working unchanged for VCOs.
    expect(ops[0].getFrequencyParam()).toBeInstanceOf(FakeParam);
  });

  it('falls back to stock oscillators without worklets, still making sound', () => {
    const ctx = makeCtx();
    const v = new VoiceCls(ctx, analogPatch(), 60, 261.63);
    expect(() => v.noteOn(1, 0)).not.toThrow();
    const ops = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] }).operators;
    expect(ops[0].getFrequencyParam()).not.toBeNull();
  });

  it('exposes a pulse width param on VCOs but not on FM operators', async () => {
    const ctx = await readyCtx();
    const v = new VoiceCls(ctx, analogPatch({
      operators: [
        { enabled: true, role: 'vco', wave: 'square' },
        { enabled: true, role: 'fm', wave: 'sine' },
      ],
    }), 60, 261.63);
    v.noteOn(1, 0);
    const ops = (v as never as { operators: { getPulseWidthParam(): FakeParam | null }[] }).operators;
    expect(ops[0].getPulseWidthParam()).toBeInstanceOf(FakeParam);
    expect(ops[1].getPulseWidthParam()).toBeNull();
  });

  it('plays noise-role operators', async () => {
    const ctx = await readyCtx();
    const patch = analogPatch({
      operators: [{ enabled: true, role: 'noise', noiseType: 'pink', level: 0.8 }],
    });
    const v = new VoiceCls(ctx, patch, 60, 261.63);
    expect(() => v.noteOn(1, 0)).not.toThrow();
    // Noise has no oscillator, so nothing can frequency-modulate it.
    const ops = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] }).operators;
    expect(ops[0].getFrequencyParam()).toBeNull();
  });
});

describe('hard sync routing', () => {
  it('connects the source into the target VCO sync input', async () => {
    const ctx = await readyCtx();
    const patch = analogPatch({
      routes: [
        { from: 0, to: 1, kind: 'sync', amount: 1 },
        { from: 1, to: 'out', kind: 'mix', amount: 1 },
      ],
    });
    const v = new VoiceCls(ctx, patch, 60, 261.63);
    v.noteOn(1, 0);

    const ops = (v as never as { operators: { unitOut: { connections: { target: unknown }[] } }[] }).operators;
    const reached = ops[0].unitOut.connections.map(c => c.target);
    expect(reached.some(t => t instanceof FakeAudioWorkletNode)).toBe(true);
  });

  it('skips a sync route whose target is not a VCO, without throwing', async () => {
    const ctx = await readyCtx();
    const patch = analogPatch({
      operators: [
        { enabled: true, role: 'vco', wave: 'sawtooth' },
        { enabled: true, role: 'fm', wave: 'sine' }, // no sync input
      ],
      routes: [
        { from: 0, to: 1, kind: 'sync', amount: 1 },
        { from: 1, to: 'out', kind: 'mix', amount: 1 },
      ],
    });
    const v = new VoiceCls(ctx, patch, 60, 261.63);
    expect(() => v.noteOn(1, 0)).not.toThrow();
  });
});

describe('analog patches end to end', () => {
  it('plays with worklets and without, identically as far as the API is concerned', async () => {
    for (const ctx of [await readyCtx(), makeCtx()]) {
      const v = new VoiceCls(ctx, analogPatch(), 60, 261.63);
      expect(() => {
        v.noteOn(0.9, 0);
        v.noteOff(0.5);
        v.dispose();
      }).not.toThrow();
    }
  });

  it('handles every filter model and mode combination', async () => {
    const ctx = await readyCtx();
    for (const model of ['biquad', 'ladder', 'svf'] as const) {
      for (const type of ['lowpass', 'highpass', 'bandpass', 'notch'] as const) {
        for (const slope of [12, 24] as const) {
          const patch = analogPatch({
            filter: { enabled: true, model, type, slope, cutoff: 900, resonance: 12 },
          });
          const v = new VoiceCls(ctx, patch, 60, 261.63);
          expect(() => { v.noteOn(1, 0); v.dispose(); }, `${model}/${type}/${slope}`).not.toThrow();
        }
      }
    }
  });
});
