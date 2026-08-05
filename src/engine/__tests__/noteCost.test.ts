import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installFakeAudio, FakeParam } from './fakeAudio';

let restore: () => void;
let AudioEngineCls: typeof import('../AudioEngine').AudioEngine;
let presets: typeof import('../../presets/PresetManager').FACTORY_PRESETS;

beforeAll(async () => {
  restore = installFakeAudio();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  AudioEngineCls = (await import('../AudioEngine')).AudioEngine;
  presets = (await import('../../presets/PresetManager')).FACTORY_PRESETS;
});

afterAll(() => restore?.());

/**
 * Everything a key-down does happens on the main thread, synchronously, between
 * the user's gesture and the next frame — so its cost is a correctness concern,
 * not a nicety.
 *
 * This caught a real failure. `Lfo` used to draw every non-plain-sine shape with
 * AudioParam automation over a fixed 120-second horizon, so the event count
 * scaled with LFO rate: the Tin Whistle patch (a 5 Hz sine with swing) cost
 * 20,181 automation calls and 21 ms of blocking work per note. Under the
 * arpeggiator that is a 21 ms freeze eight times a second, and notes drop out
 * one by one as the engine falls behind its own scheduling. Every other patch
 * cost 1-3 ms.
 */
const MAX_AUTOMATION_EVENTS_PER_NOTE = 400;

/** Count AudioParam automation calls across one note-on/note-off. */
function countAutomation(fn: () => void): number {
  let n = 0;
  const methods = ['cancelScheduledValues', 'setValueAtTime', 'linearRampToValueAtTime',
    'exponentialRampToValueAtTime', 'setTargetAtTime'] as const;
  const proto = FakeParam.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originals: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of methods) {
    originals[m] = proto[m];
    proto[m] = function (this: unknown, ...a: unknown[]) { n++; return originals[m].apply(this, a); };
  }
  try { fn(); } finally {
    for (const m of methods) proto[m] = originals[m];
  }
  return n;
}

describe('per-note scheduling cost', () => {
  it('holds for every factory preset', () => {
    const worst: Array<{ name: string; events: number }> = [];
    for (const preset of presets) {
      const engine = new AudioEngineCls();
      engine.preload();
      engine.loadPatch(preset.patch);
      // Second note, so one-off setup (wavetables, cached buffers) is not counted.
      engine.noteOn(60, 0.8);
      engine.noteOff(60);
      const events = countAutomation(() => {
        engine.noteOn(64, 0.8);
        engine.noteOff(64);
      });
      worst.push({ name: preset.name, events });
    }
    const over = worst.filter(w => w.events > MAX_AUTOMATION_EVENTS_PER_NOTE);
    expect(over.map(w => `${w.name}: ${w.events}`)).toEqual([]);
    expect(worst.length).toBeGreaterThan(5);
  });

  it('does not scale LFO scheduling with LFO rate', async () => {
    const { normalisePatch } = await import('../PatchMigration');
    const patchAt = (rate: number) => normalisePatch({
      operators: Array.from({ length: 6 }, (_, i) =>
        i === 0 ? { enabled: true, role: 'fm', wave: 'sine' } : { enabled: false }),
      // Swing is what used to force the expensive path.
      lfo1: { shape: 'sine', rate, depth: 0.5, delay: 0, sync: false, swing: 0.15 },
      modMatrix: [{ source: 'lfo1', dest: 'pitch', amount: 0.3, enabled: true }],
    });

    const cost = (rate: number) => {
      const engine = new AudioEngineCls();
      engine.preload();
      engine.loadPatch(patchAt(rate));
      engine.noteOn(60, 0.8); engine.noteOff(60);
      return countAutomation(() => { engine.noteOn(64, 0.8); engine.noteOff(64); });
    };

    const slow = cost(0.1);
    const fast = cost(20);
    expect(fast).toBeLessThanOrEqual(MAX_AUTOMATION_EVENTS_PER_NOTE);
    // A 200x rate increase must not cost measurably more to schedule.
    expect(fast).toBeLessThanOrEqual(slow + 8);
  });
});
