// Reference patches for the classic analog synths.
//
// These are the acceptance test for the Phase 2a DSP: if the ladder filter,
// PolyBLEP oscillator, PWM and hard sync are right, these sound close to their
// namesakes. If something is wrong they expose it immediately.
//
// All use `role: 'vco'` (the worklet oscillator) and `filter.model: 'ladder'` or
// 'svf'. Algorithm 16 is the fully additive topology — every operator straight
// to the output — which is what a subtractive synth's oscillator mixer is.

import type { PatchParams, OperatorParams, FilterParams } from '../engine/Types';
import { DEFAULT_PATCH, DEFAULT_OPERATOR, DEFAULT_FILTER } from '../engine/Types';
import { adsrToEnv } from '../engine/Envelope';

/** VCO shorthand. `level` is amplitude here — additive routing means no operator modulates another. */
function vco(over: Partial<OperatorParams> & { a?: number; d?: number; s?: number; r?: number } = {}): OperatorParams {
  const { a = 0.005, d = 0.3, s = 0.8, r = 0.3, ...rest } = over;
  return {
    ...DEFAULT_OPERATOR,
    role: 'vco',
    wave: 'sawtooth',
    env: adsrToEnv(a, d, s, r, { velSens: 0.5 }),
    drift: 0.25,
    ...rest,
  };
}

const OFF: OperatorParams = {
  ...DEFAULT_OPERATOR, enabled: false, env: adsrToEnv(0.01, 0.3, 0.5, 0.1),
};

function filt(over: Partial<FilterParams> & { a?: number; d?: number; s?: number; r?: number }): FilterParams {
  const { a = 0.01, d = 0.4, s = 0.4, r = 0.3, ...rest } = over;
  return { ...DEFAULT_FILTER, enabled: true, env: adsrToEnv(a, d, s, r), ...rest };
}

// ── Minimoog ───────────────────────────────────────────────────────────────
// Three oscillators, the second and third detuned, into a 24 dB ladder driven
// hard. The bass is the sound the ladder exists for: high resonance, low cutoff,
// and a fast filter envelope.

const MINIMOOG_BASS: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Minimoog Bass', author: 'CW Synth', tags: ['bass', 'analog', 'moog'],
  algorithm: 16,
  operators: [
    vco({ ratio: 1, level: 0.9, a: 0.002, d: 0.4, s: 0.7, r: 0.15 }),
    vco({ ratio: 1, fine: -7, level: 0.8, a: 0.002, d: 0.4, s: 0.7, r: 0.15 }),
    // Sub-octave pulse for weight underneath.
    vco({ ratio: 0.5, wave: 'square', pulseWidth: 0.5, level: 0.7, a: 0.002, d: 0.4, s: 0.7, r: 0.15 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    model: 'ladder', type: 'lowpass', slope: 24,
    cutoff: 260, resonance: 19, drive: 0.45,
    envAmount: 0.55, keytrack: 0.35,
    a: 0.002, d: 0.22, s: 0.12, r: 0.2,
  }),
  // The real thing is monophonic with low-note priority, and its three
  // oscillators are already detuned against each other — so no unison here,
  // just a touch of glide.
  voiceMode: 'mono',
  notePriority: 'low',
  glide: 0.04,
  polyphony: 1,
  volume: 0.75,
};

const MINIMOOG_LEAD: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Minimoog Lead', author: 'CW Synth', tags: ['lead', 'analog', 'moog'],
  algorithm: 16,
  operators: [
    vco({ ratio: 1, level: 0.85, a: 0.01, d: 0.3, s: 0.85, r: 0.25 }),
    vco({ ratio: 1, fine: 12, level: 0.75, a: 0.01, d: 0.3, s: 0.85, r: 0.25 }),
    vco({ ratio: 2, fine: -5, wave: 'square', pulseWidth: 0.35, level: 0.5, a: 0.01, d: 0.3, s: 0.8, r: 0.25 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    model: 'ladder', type: 'lowpass', slope: 24,
    cutoff: 900, resonance: 21, drive: 0.35,
    envAmount: 0.4, keytrack: 0.5,
    a: 0.01, d: 0.5, s: 0.5, r: 0.3,
  }),
  // Legato so a phrase played without gaps gets one attack, which is how lead
  // lines on a Minimoog are actually played.
  voiceMode: 'legato',
  notePriority: 'last',
  glide: 0.08,
  polyphony: 1,
  lfo1: { shape: 'sine', rate: 5.5, depth: 0.25, delay: 0.6, sync: true, swing: 0 },
  modMatrix: [{ source: 'lfo1', dest: 'pitch', amount: 0.25, enabled: true }],
  fx: {
    ...DEFAULT_PATCH.fx,
    reverb: { enabled: true, size: 0.4, damp: 0.5, mix: 0.16 },
    delay: { enabled: true, time: 0.32, feedback: 0.28, mix: 0.14, sync: false },
  },
  volume: 0.7,
};

// ── Jupiter-8 ──────────────────────────────────────────────────────────────
// Two oscillators through a series highpass into a 24 dB lowpass — the JP-8
// topology. The brass patch leans on the filter envelope; the pad leans on PWM.

const JP8_BRASS: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Jupiter Brass', author: 'CW Synth', tags: ['brass', 'analog', 'roland'],
  algorithm: 16,
  operators: [
    vco({ ratio: 1, level: 0.85, a: 0.03, d: 0.5, s: 0.75, r: 0.3 }),
    vco({ ratio: 1, fine: 9, wave: 'square', pulseWidth: 0.42, level: 0.7, a: 0.03, d: 0.5, s: 0.75, r: 0.3 }),
    OFF, OFF, OFF, OFF,
  ],
  filter: filt({
    model: 'ladder', type: 'lowpass', slope: 24,
    cutoff: 700, resonance: 9, drive: 0.2,
    hpfCutoff: 90,               // the JP-8's series highpass, thinning the low end
    envAmount: 0.5, keytrack: 0.45,
    a: 0.04, d: 0.6, s: 0.55, r: 0.35,
  }),
  // Slow PWM is most of what makes a Jupiter pad move.
  lfo1: { shape: 'triangle', rate: 0.6, depth: 0.5, delay: 0, sync: false, swing: 0 },
  fx: {
    ...DEFAULT_PATCH.fx,
    chorus: { enabled: true, rate: 0.5, depth: 0.35, mix: 0.4 },
    reverb: { enabled: true, size: 0.5, damp: 0.45, mix: 0.2 },
  },
  // Two layers per note for width without eating the whole voice budget.
  unison: { voices: 2, detune: 9, spread: 0.5 },
  polyphony: 12,
  volume: 0.7,
};

const JP8_PAD: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Jupiter Pad', author: 'CW Synth', tags: ['pad', 'analog', 'roland'],
  algorithm: 16,
  operators: [
    vco({ ratio: 1, wave: 'square', pulseWidth: 0.5, level: 0.75, a: 0.5, d: 1.2, s: 0.85, r: 1.4, drift: 0.4 }),
    vco({ ratio: 1, fine: -11, wave: 'square', pulseWidth: 0.45, level: 0.7, a: 0.6, d: 1.2, s: 0.85, r: 1.6, drift: 0.4 }),
    vco({ ratio: 2, fine: 6, level: 0.35, a: 0.8, d: 1.5, s: 0.7, r: 1.8, drift: 0.3 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    model: 'svf', type: 'lowpass', slope: 24,
    cutoff: 1400, resonance: 7, drive: 0.1,
    hpfCutoff: 60,
    envAmount: 0.3, keytrack: 0.4,
    a: 0.9, d: 1.5, s: 0.6, r: 1.6,
  }),
  lfo1: { shape: 'triangle', rate: 0.35, depth: 0.4, delay: 0.4, sync: false, swing: 0 },
  modMatrix: [{ source: 'lfo1', dest: 'filter_cutoff', amount: 0.25, enabled: true }],
  fx: {
    ...DEFAULT_PATCH.fx,
    chorus: { enabled: true, rate: 0.32, depth: 0.5, mix: 0.45 },
    reverb: { enabled: true, size: 0.8, damp: 0.35, mix: 0.35 },
  },
  unison: { voices: 2, detune: 11, spread: 0.7 },
  polyphony: 12,
  volume: 0.62,
};

// ── OB-Xa ──────────────────────────────────────────────────────────────────
// The Oberheim sound is a 2-pole state-variable filter and heavy detuning.

const OBXA_PAD: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'OB-Xa Pad', author: 'CW Synth', tags: ['pad', 'analog', 'oberheim'],
  algorithm: 16,
  operators: [
    vco({ ratio: 1, level: 0.8, a: 0.35, d: 1.0, s: 0.9, r: 1.2, drift: 0.5 }),
    vco({ ratio: 1, fine: -14, level: 0.75, a: 0.4, d: 1.0, s: 0.9, r: 1.3, drift: 0.5 }),
    vco({ ratio: 1, fine: 15, wave: 'square', pulseWidth: 0.4, level: 0.55, a: 0.45, d: 1.1, s: 0.85, r: 1.3, drift: 0.5 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    // 2-pole SVF: the softer, more open Oberheim character.
    model: 'svf', type: 'lowpass', slope: 12,
    cutoff: 1100, resonance: 11, drive: 0.15,
    envAmount: 0.45, keytrack: 0.4,
    a: 0.5, d: 1.2, s: 0.55, r: 1.2,
  }),
  lfo1: { shape: 'sine', rate: 0.45, depth: 0.35, delay: 0.8, sync: false, swing: 0 },
  modMatrix: [{ source: 'lfo1', dest: 'filter_cutoff', amount: 0.2, enabled: true }],
  fx: {
    ...DEFAULT_PATCH.fx,
    chorus: { enabled: true, rate: 0.28, depth: 0.55, mix: 0.5 },
    reverb: { enabled: true, size: 0.75, damp: 0.4, mix: 0.3 },
  },
  // Wide detuned stacking is most of the Oberheim signature.
  unison: { voices: 3, detune: 16, spread: 0.85 },
  polyphony: 12,
  volume: 0.62,
};

/**
 * OB-Xa stacked brass, in the style of the 1984 Van Halen "Jump" riff.
 *
 * An homage rather than a reproduction — the original settings were never
 * published, and even the instrument is debated (OB-Xa is the usual attribution,
 * some sources say OB-X). What the recording clearly has, and what this chases:
 *
 * - Sawtooth oscillators detuned against each other, which is where the width
 *   comes from. The OB-Xa has two VCOs per voice and both are saws here.
 * - The **2-pole** filter, left fairly open. The 4-pole is darker and rounder;
 *   the brightness of this part is the shallower slope with the cutoff up.
 * - A quick filter-envelope swell that settles — the brassy "blat" on each
 *   chord attack, not a slow pad sweep.
 * - Fast attack and a high sustain, because the part is held block chords.
 * - Chorus. A lot of the record's size is the chorus, not the synth.
 *
 * Deliberate deviations, both for the sound rather than the spec: a third
 * oscillator an octave up at low level adds the air the record has, and 2-voice
 * unison widens it further than two VCOs alone would. Drop OP3 and set unison to
 * 1 for the strictly two-oscillator version.
 *
 * Polyphony is 12 — six-note chords at two unison layers each.
 */
const JUMP_BRASS: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Jump Brass', author: 'CW Synth', tags: ['brass', 'analog', 'oberheim', '80s'],
  algorithm: 16,
  operators: [
    // The two detuned saws that carry the sound.
    vco({ ratio: 1, fine: -9, level: 0.85, a: 0.008, d: 0.6, s: 0.88, r: 0.35, drift: 0.35 }),
    vco({ ratio: 1, fine: 9,  level: 0.85, a: 0.008, d: 0.6, s: 0.88, r: 0.35, drift: 0.35 }),
    // Octave up, well back in the mix — brightness without thinning the body.
    vco({ ratio: 2, fine: 4,  level: 0.32, a: 0.012, d: 0.5, s: 0.8,  r: 0.3,  drift: 0.3 }),
    OFF, OFF, OFF,
  ],
  filter: filt({
    // 2-pole SVF, open. This is the single most important setting for the
    // character — at 24 dB/oct the same patch turns into a soft pad.
    model: 'svf', type: 'lowpass', slope: 12,
    // Cutoff sits *below* the bulk of the harmonics so the envelope sweeps
    // through them. Parked high it stays above the harmonic energy in both the
    // attack and the sustain, and the brass edge never happens — measurably so:
    // the attack/sustain brightness ratio comes out identical.
    cutoff: 800, resonance: 7, drive: 0.18,
    envAmount: 0.6, keytrack: 0.35,
    // Snappy decay to a fairly low sustain: the sweep runs about 4.2kHz down to
    // 2kHz, just over an octave, which is enough for the edge to read as an
    // attack transient rather than a slow pad swell.
    a: 0.004, d: 0.22, s: 0.35, r: 0.35,
  }),
  fx: {
    ...DEFAULT_PATCH.fx,
    chorus: { enabled: true, rate: 0.42, depth: 0.42, mix: 0.38 },
    reverb: { enabled: true, size: 0.55, damp: 0.4, mix: 0.22 },
    // Slight scoop and a presence lift — the part sits above a guitar mix.
    eq: { enabled: true, low: -1.5, mid: 2, high: 2.5, midFreq: 2500 },
  },
  unison: { voices: 2, detune: 10, spread: 0.7 },
  polyphony: 12,
  volume: 0.68,
};

// ── Hard sync demo ─────────────────────────────────────────────────────────
// Explicit `routes` rather than an algorithm: op1 syncs op2, and only op2 is
// heard. Sweeping op2's ratio gives the classic sync sweep.

const SYNC_LEAD: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Sync Lead', author: 'CW Synth', tags: ['lead', 'sync', 'analog'],
  algorithm: 16,
  routes: [
    { from: 0, to: 1, kind: 'sync', amount: 1 },
    { from: 1, to: 'out', kind: 'mix', amount: 1 },
  ],
  operators: [
    // Master: sets the pitch you hear. Not routed to the output itself.
    vco({ ratio: 1, level: 0.9, a: 0.005, d: 0.3, s: 0.9, r: 0.2 }),
    // Slave: restarted every master cycle, so its ratio sets timbre, not pitch.
    vco({ ratio: 2.8, level: 0.9, a: 0.005, d: 0.3, s: 0.9, r: 0.2 }),
    OFF, OFF, OFF, OFF,
  ],
  filter: filt({
    model: 'ladder', type: 'lowpass', slope: 24,
    cutoff: 3500, resonance: 6, drive: 0.3,
    envAmount: 0.3, keytrack: 0.4,
    a: 0.005, d: 0.4, s: 0.6, r: 0.25,
  }),
  fx: {
    ...DEFAULT_PATCH.fx,
    delay: { enabled: true, time: 0.28, feedback: 0.3, mix: 0.16, sync: false },
    reverb: { enabled: true, size: 0.45, damp: 0.5, mix: 0.18 },
  },
  voiceMode: 'legato',
  glide: 0.06,
  polyphony: 1,
  volume: 0.65,
};

export const ANALOG_PRESETS = [
  { id: 'minimoog-bass', name: 'Minimoog Bass', author: 'CW Synth', tags: ['bass', 'analog'],  patch: MINIMOOG_BASS },
  { id: 'minimoog-lead', name: 'Minimoog Lead', author: 'CW Synth', tags: ['lead', 'analog'],  patch: MINIMOOG_LEAD },
  { id: 'jp8-brass',     name: 'Jupiter Brass', author: 'CW Synth', tags: ['brass', 'analog'], patch: JP8_BRASS },
  { id: 'jp8-pad',       name: 'Jupiter Pad',   author: 'CW Synth', tags: ['pad', 'analog'],   patch: JP8_PAD },
  { id: 'obxa-pad',      name: 'OB-Xa Pad',     author: 'CW Synth', tags: ['pad', 'analog'],   patch: OBXA_PAD },
  { id: 'jump-brass',    name: 'Jump Brass',    author: 'CW Synth', tags: ['brass', '80s'],    patch: JUMP_BRASS },
  { id: 'sync-lead',     name: 'Sync Lead',     author: 'CW Synth', tags: ['lead', 'sync'],    patch: SYNC_LEAD },
];
