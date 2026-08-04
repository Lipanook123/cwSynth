// Acoustic instrument emulations.
//
// Distinct from AnalogPresets.ts, which chases specific vintage synthesisers.
// These aim at real instruments, and are built from whichever primitives suit —
// here, additive VCO partials plus noise operators rather than FM.

import type { PatchParams, OperatorParams } from '../engine/Types';
import { DEFAULT_PATCH, DEFAULT_OPERATOR, DEFAULT_FILTER } from '../engine/Types';
import { adsrToEnv } from '../engine/Envelope';

const OFF: OperatorParams = {
  ...DEFAULT_OPERATOR, enabled: false, env: adsrToEnv(0.01, 0.3, 0.5, 0.1),
};

/**
 * Tin whistle (Irish penny whistle).
 *
 * A fipple flute is close to a pure tone, so this is built additively rather
 * than with FM: a fundamental plus a modest 2nd and a slight 3rd partial, giving
 * a measured harmonic balance of 1.00 / 0.23 / 0.08. Anything above that is
 * essentially absent on a real whistle.
 *
 * The two things that stop it sounding like a sine wave:
 *
 * - **Breath noise** (OP4), sustained under the tone at roughly −21 dB. This is
 *   the defining texture of the instrument. At −30 dB it is inaudible and the
 *   patch reads as an organ; the level here was set by measurement, not by eye.
 * - **Chiff** (OP5), a separate one-shot noise burst (`sustainStage: -1`) that
 *   decays in ~60 ms, giving the breathy attack transient. It sits ~3.7× above
 *   the sustained noise floor. Its `keyRateScale` shortens it on high notes,
 *   where the real instrument's attack is quicker.
 *
 * Voicing notes: the instrument's range is D5–D7, so the filter's strong key
 * tracking matters more than its absolute cutoff. Legato with a short glide
 * mirrors how the whistle is actually played — slurred phrases with slides
 * between notes rather than separately articulated notes.
 */
const TIN_WHISTLE: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Tin Whistle',
  author: 'CW Synth',
  tags: ['wind', 'flute', 'whistle', 'acoustic', 'irish'],
  algorithm: 16, // additive — every operator straight to the filter
  operators: [
    // Fundamental. `vco` role for the free-running start phase and drift; a
    // stock oscillator always starts at phase 0 and sounds more static.
    { ...DEFAULT_OPERATOR, role: 'vco', wave: 'sine', ratio: 1, level: 0.85, drift: 0.1,
      env: adsrToEnv(0.035, 0.12, 0.94, 0.11, { velSens: 0.55 }) },
    // 2nd partial — body without reediness.
    { ...DEFAULT_OPERATOR, role: 'vco', wave: 'sine', ratio: 2, level: 0.2, drift: 0.1,
      env: adsrToEnv(0.045, 0.15, 0.9, 0.09, { velSens: 0.7 }) },
    // 3rd partial — a touch of edge, and the first thing to grow when blown hard.
    { ...DEFAULT_OPERATOR, role: 'vco', wave: 'sine', ratio: 3, level: 0.075, drift: 0.1,
      env: adsrToEnv(0.05, 0.18, 0.82, 0.08, { velSens: 0.8 }) },
    // Sustained breath noise.
    { ...DEFAULT_OPERATOR, role: 'noise', noiseType: 'white', level: 0.24,
      env: adsrToEnv(0.05, 0.2, 0.85, 0.13, { velSens: 0.75 }) },
    // Attack chiff: one-shot, so it fires once and gets out of the way.
    { ...DEFAULT_OPERATOR, role: 'noise', noiseType: 'white', level: 0.19,
      env: {
        stages: [
          { time: 0.004, level: 1, curve: 'lin' },
          { time: 0.06, level: 0, curve: 'exp' },
        ],
        sustainStage: -1,
        release: [{ time: 0.02, level: 0, curve: 'exp' }],
        velSens: 0.85,
        keyRateScale: 0.35,
        keyLevelScale: 0,
      } },
    OFF,
  ],
  filter: {
    ...DEFAULT_FILTER,
    enabled: true,
    // Gentle 2-pole: the goal is to shape the noise, not to colour the tone.
    model: 'svf', type: 'lowpass', slope: 12,
    cutoff: 2400, resonance: 4, drive: 0,
    // Clears low-frequency rumble from the white noise without touching the
    // fundamental — the whistle's lowest note is D5 at 587 Hz.
    hpfCutoff: 260,
    envAmount: 0.24,
    // High key tracking stands in for overblowing: higher notes open up.
    keytrack: 0.85,
    env: adsrToEnv(0.018, 0.16, 0.55, 0.1, { velSens: 0.5 }),
  },
  // Delayed vibrato — players do not start one on the note's attack.
  lfo1: { shape: 'sine', rate: 5.2, depth: 0.5, delay: 0.35, sync: true, swing: 0 },
  modMatrix: [
    { source: 'lfo1', dest: 'pitch', amount: 0.5, enabled: true },
    // Breath vibrato moves amplitude as well as pitch.
    { source: 'lfo1', dest: 'amp', amount: 0.18, enabled: true },
  ],
  fx: {
    ...DEFAULT_PATCH.fx,
    reverb: { enabled: true, size: 0.5, damp: 0.5, mix: 0.22 },
    // No chorus: it would break the single-instrument illusion.
    eq: { enabled: true, low: -5, mid: 1.5, high: 1, midFreq: 2500 },
  },
  voiceMode: 'legato',
  notePriority: 'last',
  glide: 0.025,
  polyphony: 1,
  volume: 0.72,
};

export const ACOUSTIC_PRESETS = [
  { id: 'tin-whistle', name: 'Tin Whistle', author: 'CW Synth',
    tags: ['wind', 'acoustic'], patch: TIN_WHISTLE },
];
