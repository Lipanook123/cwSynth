import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalisePatch, isV1Patch } from '../PatchMigration';
import { DEFAULT_PATCH, PATCH_VERSION } from '../Types';
import { envToAdsr } from '../Envelope';

const PRESET_DIR = join(__dirname, '../../presets');
const ROOT = join(__dirname, '../../..');

describe('normalisePatch', () => {
  it('returns a complete patch from empty input', () => {
    const p = normalisePatch({});
    expect(p.operators).toHaveLength(6);
    expect(p.version).toBe(PATCH_VERSION);
    expect(p.fx.reverb).toBeDefined();
    expect(p.fx.eq).toBeDefined();
  });

  it('tolerates garbage input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(() => normalisePatch(junk)).not.toThrow();
      expect(normalisePatch(junk).operators).toHaveLength(6);
    }
  });

  it('keeps the other FX sections when only one is specified', () => {
    // The old shallow spread replaced the whole `fx` object, silently dropping
    // delay/chorus/dist/eq.
    const p = normalisePatch({ fx: { reverb: { enabled: true, size: 0.9, damp: 0.1, mix: 0.5 } } });
    expect(p.fx.reverb.size).toBe(0.9);
    expect(p.fx.delay).toEqual(DEFAULT_PATCH.fx.delay);
    expect(p.fx.eq).toEqual(DEFAULT_PATCH.fx.eq);
  });

  it('fills in a missing LFO swing rather than leaving it undefined', () => {
    // An undefined swing used to crash note-on in Lfo.start().
    const p = normalisePatch({ lfo1: { shape: 'sine', rate: 6, depth: 0.07, delay: 0.25, sync: true } });
    expect(p.lfo1.swing).toBe(0);
    expect(Number.isFinite(p.lfo1.swing)).toBe(true);
  });

  it('pads a short operators array to six', () => {
    const p = normalisePatch({ operators: [{ ratio: 3 }] });
    expect(p.operators).toHaveLength(6);
    expect(p.operators[0].ratio).toBe(3);
    expect(p.operators[5].ratio).toBe(DEFAULT_PATCH.operators[5].ratio);
  });

  it('clamps the algorithm into range', () => {
    expect(normalisePatch({ algorithm: 99 }).algorithm).toBe(32);
    expect(normalisePatch({ algorithm: 0 }).algorithm).toBe(1);
    expect(normalisePatch({ algorithm: 'x' }).algorithm).toBe(DEFAULT_PATCH.algorithm);
  });

  it('rejects unknown enum values in favour of defaults', () => {
    const p = normalisePatch({
      operators: [{ wave: 'bogus', role: 'bogus' }],
      filter: { type: 'bogus' },
      lfo1: { shape: 'bogus' },
    });
    expect(p.operators[0].wave).toBe('sine');
    expect(p.operators[0].role).toBe('fm');
    expect(p.filter.type).toBe('lowpass');
    expect(p.lfo1.shape).toBe('sine');
  });

  it('drops malformed mod slots but keeps valid ones', () => {
    const p = normalisePatch({
      modMatrix: [
        { source: 'lfo1', dest: 'pitch', amount: 0.3, enabled: true },
        { nonsense: true },
      ],
    });
    expect(p.modMatrix).toHaveLength(1);
    expect(p.modMatrix[0].dest).toBe('pitch');
  });
});

describe('v1 → v2 migration', () => {
  const v1Operator = {
    enabled: true, wave: 'sine', wavetableData: null, ratio: 2, fine: 5,
    fixed: false, fixedFreq: 440, level: 0.7, feedback: 0.1,
    attack: 0.02, decay: 0.4, sustain: 0.3, release: 0.5,
    karplusStrong: false, ksDecay: 0.995,
  };

  it('detects a v1 patch', () => {
    expect(isV1Patch({ version: 1, operators: [v1Operator] })).toBe(true);
    expect(isV1Patch({ version: 2, operators: [] })).toBe(false);
  });

  it('folds flat ADSR into an envelope', () => {
    const p = normalisePatch({ version: 1, operators: [v1Operator] });
    expect(envToAdsr(p.operators[0].env)).toEqual({
      attack: 0.02, decay: 0.4, sustain: 0.3, release: 0.5,
    });
    expect(p.operators[0].ratio).toBe(2);
    expect(p.operators[0].role).toBe('fm');
    expect(p.version).toBe(PATCH_VERSION);
  });

  it('migrates the filter envelope too', () => {
    const p = normalisePatch({
      version: 1,
      filter: { enabled: true, type: 'lowpass', cutoff: 800, resonance: 4,
                envAmount: 0.6, attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.2, keytrack: 0.3 },
    });
    expect(envToAdsr(p.filter.env)).toEqual({
      attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.2,
    });
    expect(p.filter.cutoff).toBe(800);
  });

  it('leaves an already-v2 envelope alone', () => {
    const v2 = normalisePatch({ version: 1, operators: [v1Operator] });
    const again = normalisePatch(JSON.parse(JSON.stringify(v2)));
    expect(again.operators[0].env).toEqual(v2.operators[0].env);
  });
});

describe('checked-in .cwsyn files', () => {
  const files = [
    ...readdirSync(PRESET_DIR).filter(f => f.endsWith('.cwsyn')).map(f => join(PRESET_DIR, f)),
    join(ROOT, '909-snare.cwsyn'),
  ];

  it('finds the preset files', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files)('loads %s into a complete v2 patch', file => {
    const patch = normalisePatch(JSON.parse(readFileSync(file, 'utf8')));

    expect(patch.operators).toHaveLength(6);
    expect(patch.version).toBe(PATCH_VERSION);

    // Every numeric field the engine reads must be finite — an undefined here is
    // what used to crash note-on.
    expect(Number.isFinite(patch.lfo1.swing)).toBe(true);
    expect(Number.isFinite(patch.lfo2.swing)).toBe(true);
    expect(Number.isFinite(patch.volume)).toBe(true);
    expect(Number.isFinite(patch.polyphony)).toBe(true);

    for (const op of patch.operators) {
      expect(Number.isFinite(op.ratio)).toBe(true);
      expect(Number.isFinite(op.level)).toBe(true);
      expect(op.env.stages.length).toBeGreaterThan(0);
      expect(op.env.release.length).toBeGreaterThan(0);
      for (const st of [...op.env.stages, ...op.env.release]) {
        expect(Number.isFinite(st.time)).toBe(true);
        expect(Number.isFinite(st.level)).toBe(true);
      }
    }
  });
});
