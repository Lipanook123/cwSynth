import {
  type PatchParams, type OperatorParams, type FilterParams,
  DEFAULT_PATCH, DEFAULT_OPERATOR, DEFAULT_FILTER,
} from '../engine/Types';
import { adsrToEnv } from '../engine/Envelope';
import { normalisePatch } from '../engine/PatchMigration';
import { ANALOG_PRESETS } from './AnalogPresets';

export interface PresetMeta {
  id: string;
  name: string;
  author: string;
  tags: string[];
  patch: PatchParams;
}

/**
 * Operator shorthand for the factory presets.
 *
 * `level` means amplitude for a carrier and FM index for a modulator — see
 * levelToIndex() in Operator.ts. Roughly: 0.3 ≈ index 0.5 (a hint of
 * brightness), 0.5 ≈ 1.8 (clearly harmonic), 0.7 ≈ 4.1 (aggressive).
 */
function op(
  a: number, d: number, s: number, r: number,
  over: Partial<OperatorParams> & { velSens?: number } = {},
): OperatorParams {
  const { velSens, ...rest } = over;
  return {
    ...DEFAULT_OPERATOR,
    env: adsrToEnv(a, d, s, r, { velSens: velSens ?? 0.7 }),
    ...rest,
  };
}

const OFF: OperatorParams = { ...DEFAULT_OPERATOR, enabled: false, env: adsrToEnv(0.01, 0.3, 0.5, 0.1) };

function filt(over: Partial<FilterParams>): FilterParams {
  return { ...DEFAULT_FILTER, ...over };
}

// Algorithm 5 = (6→5)+(4→3)+(2→1): carriers op1/op3/op5, each modulated by its neighbour.
const WHISTLE_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Whistle', author: 'CW Synth', tags: ['wind', 'organic'],
  algorithm: 5,
  operators: [
    // Carrier — a near-pure sine, very slightly sharp for a breathy beat against op3.
    op(0.01, 0.15, 0.8, 0.1,  { ratio: 1,    fine: 2,  level: 0.8,  feedback: 0.02 }),
    // Modulator at 2× — low index, just enough to add an octave shimmer.
    op(0.02, 0.25, 0.4, 0.1,  { ratio: 1.99, level: 0.24 }),
    // Second carrier, detuned flat: the chorusing that makes it sound blown.
    op(0.005, 0.06, 0.12, 0.04, { ratio: 1,  fine: -2, level: 0.12 }),
    OFF, OFF, OFF,
  ],
  lfo1: { shape: 'sine', rate: 6, depth: 0.07, delay: 0.25, sync: true, swing: 0 },
  modMatrix: [{ source: 'lfo1', dest: 'pitch', amount: 0.3, enabled: true }],
  fx: {
    reverb: { enabled: true,  size: 0.4, damp: 0.6, mix: 0.15 },
    delay:  { enabled: false, time: 0.3, feedback: 0.3, mix: 0.2, sync: false },
    chorus: { enabled: false, rate: 0.5, depth: 0.3, mix: 0.4 },
    dist:   { enabled: false, drive: 2, tone: 0.5, mix: 0.5, mode: 'soft' },
    eq:     { enabled: true,  low: -3, mid: 2, high: 1, midFreq: 3000 },
  },
  volume: 0.65,
};

// The classic DX-7 tine: a high-ratio modulator with a fast-decaying envelope,
// so the metallic attack rings briefly and then leaves a clean sine body.
const EP_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'E. Piano', author: 'CW Synth', tags: ['keys', 'warm'],
  algorithm: 5,
  operators: [
    op(0.001, 0.8,  0,   0.5, { ratio: 1,  level: 1.0, velSens: 0.8 }),
    op(0.001, 0.18, 0,   0.2, { ratio: 14, level: 0.45, velSens: 0.9 }),
    op(0.001, 1.2,  0,   0.6, { ratio: 1,  level: 0.55, velSens: 0.8 }),
    op(0.001, 0.3,  0,   0.2, { ratio: 7,  level: 0.3,  velSens: 0.9 }),
    OFF, OFF,
  ],
  fx: {
    reverb: { enabled: true,  size: 0.5, damp: 0.5, mix: 0.2 },
    delay:  { enabled: false, time: 0.375, feedback: 0.4, mix: 0.2, sync: false },
    chorus: { enabled: true,  rate: 0.4, depth: 0.2, mix: 0.3 },
    dist:   { enabled: false, drive: 2, tone: 0.5, mix: 0.5, mode: 'soft' },
    eq:     { enabled: false, low: 0, mid: 0, high: 0, midFreq: 1000 },
  },
  volume: 0.75,
};

// Algorithm 3 = (6→5→4)+(3→2→1): two independent stacks. Inharmonic ratios on
// the modulators are what make it clang rather than sing.
const BELL_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Bell', author: 'CW Synth', tags: ['bell', 'metallic'],
  algorithm: 3,
  operators: [
    op(0.001, 2.5, 0, 1.8, { ratio: 1,   level: 1.0 }),
    op(0.001, 1.0, 0, 0.8, { ratio: 3.5, level: 0.5 }),
    op(0.001, 0.6, 0, 0.4, { ratio: 1,   level: 0.35 }),
    op(0.001, 2.0, 0, 1.5, { ratio: 5.0, level: 0.5 }),
    OFF, OFF,
  ],
  fx: {
    reverb: { enabled: true,  size: 0.8, damp: 0.3, mix: 0.35 },
    delay:  { enabled: true,  time: 0.5, feedback: 0.3, mix: 0.15, sync: false },
    chorus: { enabled: false, rate: 0.5, depth: 0.3, mix: 0.4 },
    dist:   { enabled: false, drive: 2, tone: 0.5, mix: 0.5, mode: 'soft' },
    eq:     { enabled: false, low: 0, mid: 0, high: 0, midFreq: 1000 },
  },
  volume: 0.7,
};

// Algorithm 1 = a single 6→…→1 chain. With ops 4-6 off this is op3→op2→op1.
const BASS_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Synth Bass', author: 'CW Synth', tags: ['bass', 'punchy'],
  algorithm: 1,
  operators: [
    op(0.001, 0.3,  0.6, 0.15, { ratio: 1, level: 1.0, feedback: 0.12 }),
    op(0.001, 0.15, 0.3, 0.1,  { ratio: 1, level: 0.5 }),
    op(0.001, 0.1,  0,   0.1,  { ratio: 2, level: 0.3 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    enabled: true, type: 'lowpass', cutoff: 800, resonance: 4,
    envAmount: 0.6, env: adsrToEnv(0.005, 0.25, 0.1, 0.2), keytrack: 0.3,
  }),
  fx: {
    reverb: { enabled: false, size: 0.3, damp: 0.7, mix: 0.1 },
    delay:  { enabled: false, time: 0.375, feedback: 0.3, mix: 0.15, sync: false },
    chorus: { enabled: false, rate: 0.5, depth: 0.3, mix: 0.4 },
    dist:   { enabled: true,  drive: 1.5, tone: 0.4, mix: 0.3, mode: 'soft' },
    eq:     { enabled: true,  low: 3, mid: -2, high: -1, midFreq: 500 },
  },
  volume: 0.8,
};

export const FACTORY_PRESETS: PresetMeta[] = [
  { id:'init',    name:'Init',       author:'CW Synth', tags:['init'],            patch:{ ...DEFAULT_PATCH, name:'Init' } },
  { id:'whistle', name:'Whistle',    author:'CW Synth', tags:['wind','organic'],  patch:WHISTLE_PATCH },
  { id:'ep',      name:'E. Piano',   author:'CW Synth', tags:['keys','warm'],     patch:EP_PATCH },
  { id:'bell',    name:'Bell',       author:'CW Synth', tags:['bell','metallic'], patch:BELL_PATCH },
  { id:'bass',    name:'Synth Bass', author:'CW Synth', tags:['bass','punchy'],   patch:BASS_PATCH },
  // Analog reference patches — see AnalogPresets.ts
  ...ANALOG_PRESETS,
];

const USER_KEY = 'cwsynth_user_presets';

export class PresetManager {
  private userPresets: PresetMeta[] = [];
  constructor() { this._loadFromStorage(); }
  all(): PresetMeta[] { return [...FACTORY_PRESETS, ...this.userPresets]; }

  save(name: string, patch: PatchParams, tags: string[] = []) {
    const id = `user_${Date.now()}`;
    const meta: PresetMeta = { id, name, author:'User', tags, patch };
    this.userPresets.push(meta);
    this._saveToStorage();
    return meta;
  }
  delete(id: string) { this.userPresets = this.userPresets.filter(p => p.id !== id); this._saveToStorage(); }

  exportFile(patch: PatchParams, name: string) {
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type:'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/\s+/g,'_')}.cwsyn`;
    a.click();
  }

  async importFile(file: File): Promise<PatchParams> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error('Could not read file'));
      r.onload = e => {
        try {
          // normalisePatch validates and fills every field, and upgrades v1
          // patches. The old shallow spread dropped whole nested sections and
          // let undefined fields through, which crashed note-on.
          res(normalisePatch(JSON.parse(e.target!.result as string)));
        } catch {
          rej(new Error('Invalid .cwsyn file'));
        }
      };
      r.readAsText(file);
    });
  }

  private _loadFromStorage() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as PresetMeta[];
      // User presets saved before v2 still carry flat ADSR, so migrate on read.
      this.userPresets = stored.map(p => ({ ...p, patch: normalisePatch(p.patch) }));
    } catch {}
  }
  private _saveToStorage() { try { localStorage.setItem(USER_KEY, JSON.stringify(this.userPresets)); } catch {} }
}

export const presetManager = new PresetManager();
