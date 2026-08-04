import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installFakeAudio } from './fakeAudio';
import { normalisePatch } from '../PatchMigration';

let restore: () => void;
let AudioEngineCls: typeof import('../AudioEngine').AudioEngine;

beforeAll(async () => {
  restore = installFakeAudio();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  AudioEngineCls = (await import('../AudioEngine')).AudioEngine;
});

afterAll(() => restore?.());

type Stacks = Map<number, { noteHz: number; semitone: number; output: { gain: { value: number } } }[]>;
const stacksOf = (e: unknown) => (e as { stacks: Stacks }).stacks;

function engineWith(over: Record<string, unknown>) {
  const engine = new AudioEngineCls();
  engine.loadPatch(normalisePatch(over));
  return engine;
}

describe('unison', () => {
  it('creates one voice per note when unison is off', () => {
    const e = engineWith({});
    e.noteOn(60, 0.8);
    expect(stacksOf(e).get(60)!.length).toBe(1);
    expect(e.getVoiceCount()).toBe(1);
    e.dispose();
  });

  it('stacks the requested number of voices', () => {
    const e = engineWith({ unison: { voices: 5, detune: 12, spread: 0.6 } });
    e.noteOn(60, 0.8);
    expect(stacksOf(e).get(60)!.length).toBe(5);
    expect(e.getVoiceCount()).toBe(5);
    e.dispose();
  });

  it('detunes the stack symmetrically about the centre pitch', () => {
    const e = engineWith({ unison: { voices: 5, detune: 20, spread: 0 } });
    e.noteOn(69, 0.8); // A4 = 440
    const hz = stacksOf(e).get(69)!.map(v => v.noteHz);

    expect(hz[0]).toBeLessThan(440);
    expect(hz[4]).toBeGreaterThan(440);
    // Odd counts keep the middle layer exactly in tune, so the stack does not
    // sound uniformly sharp or flat.
    expect(hz[2]).toBeCloseTo(440, 4);
    // Total spread is `detune` cents end to end.
    const cents = 1200 * Math.log2(hz[4] / hz[0]);
    expect(cents).toBeCloseTo(20, 1);
    e.dispose();
  });

  it('keeps a unison stack from being louder than a single voice', () => {
    const single = engineWith({});
    single.noteOn(60, 0.8);
    const one = stacksOf(single).get(60)![0].output.gain.value;
    single.dispose();

    const stacked = engineWith({ unison: { voices: 4, detune: 10, spread: 0.5 } });
    stacked.noteOn(60, 0.8);
    const each = stacksOf(stacked).get(60)!.map(v => v.output.gain.value);
    stacked.dispose();

    expect(one).toBeCloseTo(1, 6);
    for (const g of each) expect(g).toBeLessThan(one);
  });

  it('counts unison layers against the polyphony ceiling', () => {
    // 4 layers per note with a limit of 9 leaves room for two notes, not nine.
    const e = engineWith({ polyphony: 9, unison: { voices: 4, detune: 10, spread: 0 } });
    for (const semi of [60, 62, 64, 66]) e.noteOn(semi, 0.8);
    expect(e.getVoiceCount()).toBeLessThanOrEqual(9);
    expect(e.getActiveNotes().size).toBe(2);
    e.dispose();
  });

  it('releases every layer of a stack on note-off', () => {
    const e = engineWith({ unison: { voices: 3, detune: 10, spread: 0.5 } });
    e.noteOn(60, 0.8);
    e.noteOff(60);
    expect(stacksOf(e).size).toBe(0);
    e.dispose();
  });
});

describe('mono note priority', () => {
  it('plays only one note at a time', () => {
    const e = engineWith({ voiceMode: 'mono' });
    e.noteOn(60, 0.8);
    e.noteOn(64, 0.8);
    e.noteOn(67, 0.8);
    expect(stacksOf(e).size).toBe(1);
    e.dispose();
  });

  it('last priority sounds the most recently pressed note', () => {
    const e = engineWith({ voiceMode: 'mono', notePriority: 'last' });
    e.noteOn(60, 0.8);
    e.noteOn(64, 0.8);
    expect([...stacksOf(e).keys()]).toEqual([64]);
    e.dispose();
  });

  it('low priority sounds the lowest held note', () => {
    const e = engineWith({ voiceMode: 'mono', notePriority: 'low' });
    e.noteOn(64, 0.8);
    e.noteOn(60, 0.8);
    e.noteOn(67, 0.8);
    expect([...stacksOf(e).keys()]).toEqual([60]);
    e.dispose();
  });

  it('high priority sounds the highest held note', () => {
    const e = engineWith({ voiceMode: 'mono', notePriority: 'high' });
    e.noteOn(64, 0.8);
    e.noteOn(67, 0.8);
    e.noteOn(60, 0.8);
    expect([...stacksOf(e).keys()]).toEqual([67]);
    e.dispose();
  });

  it('falls back to the still-held note when one is released', () => {
    // This is what lets you trill on a monosynth: releasing the upper note
    // should drop back to the one still under your finger, not go silent.
    const e = engineWith({ voiceMode: 'mono', notePriority: 'last' });
    e.noteOn(60, 0.8);
    e.noteOn(64, 0.8);
    expect([...stacksOf(e).keys()]).toEqual([64]);
    e.noteOff(64);
    expect([...stacksOf(e).keys()]).toEqual([60]);
    e.dispose();
  });

  it('goes silent only when the last held note is released', () => {
    const e = engineWith({ voiceMode: 'mono' });
    e.noteOn(60, 0.8);
    e.noteOn(64, 0.8);
    e.noteOff(64);
    expect(stacksOf(e).size).toBe(1);
    e.noteOff(60);
    expect(stacksOf(e).size).toBe(0);
    e.dispose();
  });

  it('ignores note-off for a key that was never held', () => {
    const e = engineWith({ voiceMode: 'mono' });
    e.noteOn(60, 0.8);
    expect(() => e.noteOff(72)).not.toThrow();
    expect([...stacksOf(e).keys()]).toEqual([60]);
    e.dispose();
  });

  it('does not accumulate duplicates when a key repeats', () => {
    const e = engineWith({ voiceMode: 'mono' });
    e.noteOn(60, 0.8);
    e.noteOn(60, 0.8);
    e.noteOff(60);
    expect(stacksOf(e).size).toBe(0);
    e.dispose();
  });

  it('combines mono with unison', () => {
    const e = engineWith({ voiceMode: 'mono', unison: { voices: 3, detune: 12, spread: 0.4 } });
    e.noteOn(60, 0.8);
    expect(stacksOf(e).get(60)!.length).toBe(3);
    e.noteOn(64, 0.8);
    expect(stacksOf(e).size).toBe(1);
    expect(stacksOf(e).get(64)!.length).toBe(3);
    e.dispose();
  });
});

describe('legato', () => {
  it('retunes the sounding voice instead of starting a new one', () => {
    const e = engineWith({ voiceMode: 'legato', glide: 0.1 });
    e.noteOn(60, 0.8);
    const first = stacksOf(e).get(60)![0];
    e.noteOn(64, 0.8);
    const second = stacksOf(e).get(64)![0];
    // Same Voice object, moved to the new key — that is what "does not
    // retrigger" means in practice.
    expect(second).toBe(first);
    expect(second.semitone).toBe(64);
    e.dispose();
  });

  it('mono mode does retrigger, unlike legato', () => {
    const e = engineWith({ voiceMode: 'mono', glide: 0.1 });
    e.noteOn(60, 0.8);
    const first = stacksOf(e).get(60)![0];
    e.noteOn(64, 0.8);
    const second = stacksOf(e).get(64)![0];
    expect(second).not.toBe(first);
    e.dispose();
  });

  it('moves the retuned voice to the new pitch', () => {
    const e = engineWith({ voiceMode: 'legato', glide: 0.05 });
    e.noteOn(69, 0.8);            // A4 = 440
    e.noteOn(81, 0.8);            // A5 = 880
    expect(stacksOf(e).get(81)![0].noteHz).toBeCloseTo(880, 4);
    e.dispose();
  });

  it('retunes every layer of a unison stack', () => {
    const e = engineWith({
      voiceMode: 'legato', glide: 0.05,
      unison: { voices: 3, detune: 12, spread: 0.4 },
    });
    e.noteOn(69, 0.8);
    e.noteOn(81, 0.8);
    const hz = stacksOf(e).get(81)!.map(v => v.noteHz);
    expect(hz.length).toBe(3);
    // Still detuned around the new centre pitch.
    expect(hz[1]).toBeCloseTo(880, 3);
    expect(hz[0]).toBeLessThan(880);
    expect(hz[2]).toBeGreaterThan(880);
    e.dispose();
  });
});

describe('glide', () => {
  it('plays without throwing across modes and glide times', () => {
    for (const voiceMode of ['poly', 'mono', 'legato'] as const) {
      for (const glide of [0, 0.05, 0.5]) {
        const e = engineWith({ voiceMode, glide });
        expect(() => {
          e.noteOn(48, 0.8);
          e.noteOn(72, 0.8);
          e.noteOff(48);
          e.noteOff(72);
        }, `${voiceMode} glide=${glide}`).not.toThrow();
        e.dispose();
      }
    }
  });

  it('survives a fixed-frequency operator, which must not glide', () => {
    const e = engineWith({
      voiceMode: 'mono', glide: 0.2,
      operators: [{ enabled: true, fixed: true, fixedFreq: 220 }],
    });
    expect(() => { e.noteOn(48, 0.8); e.noteOn(72, 0.8); }).not.toThrow();
    e.dispose();
  });
});
