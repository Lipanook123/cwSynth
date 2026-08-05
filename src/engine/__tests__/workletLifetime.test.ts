import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installFakeAudio, FakeAudioWorkletNode } from './fakeAudio';
import { normalisePatch } from '../PatchMigration';

let restore: () => void;
let AudioEngineCls: typeof import('../AudioEngine').AudioEngine;
let loadWorkletsFn: typeof import('../worklets').loadWorklets;

beforeAll(async () => {
  restore = installFakeAudio();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  AudioEngineCls = (await import('../AudioEngine')).AudioEngine;
  loadWorkletsFn = (await import('../worklets')).loadWorklets;
});

afterAll(() => restore?.());

/**
 * Track which AudioWorkletNodes were told to retire and which were not.
 *
 * An AudioWorkletProcessor whose process() returns true is never collected,
 * even after its node is disconnected — it keeps running for the life of the
 * context. Every worklet node the engine creates must therefore be explicitly
 * retired, or each note leaks a processor and the audio thread starves. This
 * happened for real: the ladder filter had no stop handling, so arpeggiated
 * playing on any analog patch went silent within about a minute.
 */
function trackWorklets() {
  // Counted per node, not per message: a node may legitimately be told to stop
  // more than once — the filter gets a deadline when its voice releases and
  // another when the voice is disposed — and comparing message totals would let
  // one node stopped twice cover for another never stopped at all.
  const created = new Set<object>();
  const stopped = new Set<object>();
  const g = globalThis as Record<string, unknown>;
  const Base = g.AudioWorkletNode as typeof FakeAudioWorkletNode;

  class Tracked extends Base {
    constructor(ctx: unknown, name: string) {
      super(ctx, name);
      created.add(this);
      const inner = this.port.postMessage;
      // Arrow function: `this` is the node, which is what gets recorded.
      this.port.postMessage = (msg: { type?: string }) => {
        if (msg?.type === 'stop') stopped.add(this);
        return inner.call(this.port, msg);
      };
    }
  }
  g.AudioWorkletNode = Tracked;
  const stats = {
    get created() { return created.size; },
    get stopped() { return stopped.size; },
    get leaked() { return [...created].filter(n => !stopped.has(n)).length; },
  };
  return { stats, restore: () => { g.AudioWorkletNode = Base; } };
}

/** Play `count` notes and let every voice be torn down. */
async function playAndRetire(patch: ReturnType<typeof normalisePatch>, count: number) {
  vi.useFakeTimers();
  try {
    const engine = new AudioEngineCls();
    await loadWorkletsFn((engine as never as { ctx: AudioContext }).ctx
      ?? (engine.preload(), (engine as never as { ctx: AudioContext }).ctx));
    engine.loadPatch(patch);
    for (let i = 0; i < count; i++) {
      engine.noteOn(60 + (i % 12), 0.8);
      engine.noteOff(60 + (i % 12));
    }
    // Voice teardown is deferred by release time; run every pending timer.
    vi.advanceTimersByTime(60_000);
    engine.dispose();
    vi.advanceTimersByTime(60_000);
  } finally {
    vi.useRealTimers();
  }
}

const ANALOG = () => normalisePatch({
  algorithm: 16,
  operators: Array.from({ length: 6 }, (_, i) =>
    i < 3
      ? { enabled: true, role: 'vco', wave: 'sawtooth', level: 0.8 }
      : { enabled: false }),
  filter: { enabled: true, model: 'ladder', cutoff: 800, resonance: 18 },
});

describe('worklet lifetime', () => {
  it('retires every worklet node it creates', async () => {
    const { stats, restore: undo } = trackWorklets();
    try {
      await playAndRetire(ANALOG(), 40);
      expect(stats.created).toBeGreaterThan(0);
      // The leak showed up as a fixed shortfall: 3 oscillators stopped per
      // voice but the 4th node, the filter, never was.
      expect(stats.leaked).toBe(0);
    } finally { undo(); }
  });

  it('retires the filter worklet, not just the oscillators', async () => {
    // A patch with a ladder filter and NO vco operators: every worklet created
    // is a filter, so a shortfall here can only be the filter leaking.
    const { stats, restore: undo } = trackWorklets();
    try {
      await playAndRetire(normalisePatch({
        algorithm: 16,
        operators: Array.from({ length: 6 }, (_, i) =>
          i === 0 ? { enabled: true, role: 'fm', wave: 'sine', level: 0.8 } : { enabled: false }),
        filter: { enabled: true, model: 'ladder', cutoff: 900, resonance: 20 },
      }), 25);
      expect(stats.created).toBeGreaterThan(0);
      expect(stats.leaked).toBe(0);
    } finally { undo(); }
  });

  it('creates no worklets for an all-biquad, all-fm patch', async () => {
    const { stats, restore: undo } = trackWorklets();
    try {
      await playAndRetire(normalisePatch({
        algorithm: 16,
        operators: Array.from({ length: 6 }, (_, i) =>
          i === 0 ? { enabled: true, role: 'fm', wave: 'sine' } : { enabled: false }),
        filter: { enabled: true, model: 'biquad' },
      }), 10);
      expect(stats.created).toBe(0);
    } finally { undo(); }
  });
});
