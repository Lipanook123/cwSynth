import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeAudio } from './fakeAudio';
import { normalisePatch } from '../PatchMigration';
import { randomPatch } from '../Randomiser';
import type { PatchParams } from '../Types';

const PRESET_DIR = join(__dirname, '../../presets');
const ROOT = join(__dirname, '../../..');

let restore: () => void;
let AudioEngineCls: typeof import('../AudioEngine').AudioEngine;
let FACTORY: typeof import('../../presets/PresetManager').FACTORY_PRESETS;

beforeAll(async () => {
  restore = installFakeAudio();
  vi.stubGlobal('localStorage', {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  });
  // Imported after the fake is installed, since these modules construct
  // singletons at load time.
  AudioEngineCls = (await import('../AudioEngine')).AudioEngine;
  FACTORY = (await import('../../presets/PresetManager')).FACTORY_PRESETS;
});

afterAll(() => restore?.());

/** Load a patch, play a chord, hold, release. Throws if the engine does. */
function playThrough(patch: PatchParams) {
  const engine = new AudioEngineCls();
  engine.loadPatch(patch);
  for (const semi of [36, 60, 64, 67, 84]) engine.noteOn(semi, 0.9);
  for (const semi of [36, 60, 64, 67, 84]) engine.noteOff(semi);
  engine.allNotesOff();
  engine.dispose();
}

describe('engine smoke', () => {
  it('plays the default patch', () => {
    expect(() => playThrough(normalisePatch({}))).not.toThrow();
  });

  it('ships the FM and analog factory presets', () => {
    const ids = FACTORY.map(p => p.id);
    expect(ids).toEqual(expect.arrayContaining(['init', 'whistle', 'ep', 'bell', 'bass']));
    expect(ids).toEqual(expect.arrayContaining([
      'minimoog-bass', 'minimoog-lead', 'jp8-brass', 'jp8-pad', 'obxa-pad', 'sync-lead',
    ]));
  });

  // Iterate the real list rather than a hardcoded one, so a new preset is
  // covered the moment it is registered.
  it('plays every factory preset', () => {
    for (const preset of FACTORY) {
      expect(() => playThrough(preset.patch), preset.id).not.toThrow();
    }
  });

  const files = [
    ...readdirSync(PRESET_DIR).filter(f => f.endsWith('.cwsyn')).map(f => join(PRESET_DIR, f)),
    join(ROOT, '909-snare.cwsyn'),
  ];

  it.each(files)('plays %s end to end', file => {
    const patch = normalisePatch(JSON.parse(readFileSync(file, 'utf8')));
    expect(() => playThrough(patch)).not.toThrow();
  });

  it('plays a patch whose LFO omits swing', () => {
    // whistle.cwsyn used to ship without `swing`, and its active lfo1→pitch mod
    // slot made Lfo.start() throw on the first note. Regression guard.
    const patch = normalisePatch({
      lfo1: { shape: 'sine', rate: 6, depth: 0.5, delay: 0, sync: true },
      modMatrix: [{ source: 'lfo1', dest: 'pitch', amount: 0.5, enabled: true }],
    });
    expect(() => playThrough(patch)).not.toThrow();
  });

  it('drives every mod destination without throwing', () => {
    const dests = [
      'pitch', 'amp', 'filter_cutoff', 'filter_res',
      'op1_level', 'op3_level', 'op1_ratio', 'op6_ratio',
      'fx_reverb', 'fx_delay', 'fx_chorus',
    ];
    const patch = normalisePatch({
      filter: { enabled: true },
      modMatrix: dests.map(dest => ({ source: 'lfo1', dest, amount: 0.5, enabled: true })),
    });
    expect(() => playThrough(patch)).not.toThrow();
  });

  it('plays every algorithm', () => {
    for (let algorithm = 1; algorithm <= 32; algorithm++) {
      const patch = normalisePatch({ algorithm });
      expect(() => playThrough(patch), `algorithm ${algorithm}`).not.toThrow();
    }
  });

  it('plays randomised patches in both modes', () => {
    for (const mode of ['safe', 'wild'] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        expect(() => playThrough(randomPatch(seed, mode)), `${mode} seed ${seed}`).not.toThrow();
      }
    }
  });

  it('caps voices at the polyphony limit', () => {
    const engine = new AudioEngineCls();
    engine.loadPatch(normalisePatch({ polyphony: 4 }));
    for (let semi = 40; semi < 70; semi++) engine.noteOn(semi, 0.8);
    expect(engine.getActiveNotes().size).toBeLessThanOrEqual(4);
    engine.dispose();
  });

  it('handles note-off for a note that was stolen', () => {
    const engine = new AudioEngineCls();
    engine.loadPatch(normalisePatch({ polyphony: 2 }));
    for (const semi of [60, 62, 64, 66]) engine.noteOn(semi, 0.8);
    // 60 and 62 were stolen; releasing them must not throw.
    expect(() => { for (const semi of [60, 62, 64, 66]) engine.noteOff(semi); }).not.toThrow();
    engine.dispose();
  });

  it('survives retriggering the same note repeatedly', () => {
    const engine = new AudioEngineCls();
    engine.loadPatch(normalisePatch({}));
    expect(() => {
      for (let i = 0; i < 50; i++) { engine.noteOn(60, 0.8); engine.noteOff(60); }
    }).not.toThrow();
    engine.dispose();
  });

  it('applies transpose to the sounding pitch', () => {
    const engine = new AudioEngineCls();
    engine.loadPatch(normalisePatch({ transpose: 12 }));
    engine.noteOn(69, 0.8); // A4 + 12 semitones = A5 = 880 Hz
    const voice = (engine as never as { voices: Map<number, { noteHz: number }> }).voices.get(69);
    expect(voice!.noteHz).toBeCloseTo(880, 6);
    engine.dispose();
  });

  it('applies master volume exactly once', () => {
    const engine = new AudioEngineCls();
    engine.loadPatch(normalisePatch({ volume: 0.5 }));
    engine.noteOn(60, 0.8);
    const e = engine as never as {
      masterGain: { gain: { value: number } };
      voices: Map<number, { output: { gain: { value: number } } }>;
    };
    expect(e.masterGain.gain.value).toBe(0.5);
    expect(e.voices.get(60)!.output.gain.value).toBe(1);
    engine.dispose();
  });
});
