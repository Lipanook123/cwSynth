// Topology-preserving-transform state variable filter (Cytomic / Zavalishin).
//
// Two poles, giving lowpass, highpass, bandpass and notch simultaneously from
// one structure. This is the Oberheim/Prophet flavour — softer and more open
// than the Moog ladder, and the right model for OB-Xa's 2-pole mode.
//
// Unconditionally stable at any cutoff/resonance, which is why it is worth
// having alongside the ladder rather than deriving everything from one filter.

import type { FilterMode } from './LadderFilter';

const MIN_CUTOFF = 10;

/** k = 1/Q. Resonance 1 drives k to ~0, where the filter self-oscillates. */
const MIN_K = 0.02;

export class StateVariableFilter {
  // One integrator pair per cascaded section. The 24 dB/oct mode runs the core
  // twice, and each pass needs its own state — sharing it makes the second pass
  // corrupt the first and the response comes out shallower, not steeper.
  private ic1eq = [0, 0];
  private ic2eq = [0, 0];
  private sampleRate: number;

  private cachedCutoff = -1;
  private g = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  setSampleRate(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.cachedCutoff = -1;
    this.reset();
  }

  reset() {
    this.ic1eq[0] = this.ic1eq[1] = 0;
    this.ic2eq[0] = this.ic2eq[1] = 0;
  }

  private updateCoeff(cutoffHz: number) {
    if (cutoffHz === this.cachedCutoff) return;
    this.cachedCutoff = cutoffHz;
    const nyquist = this.sampleRate * 0.5;
    const fc = Math.min(Math.max(cutoffHz, MIN_CUTOFF), nyquist * 0.98);
    this.g = Math.tan((Math.PI * fc) / this.sampleRate);
  }

  /**
   * One sample.
   *
   * `slope` of 24 runs the 2-pole core twice in series. That is not identical to
   * a true 4-pole design, but it is the standard way to get a steeper OB-style
   * response and it stays unconditionally stable.
   */
  process(
    x: number,
    cutoffHz: number,
    resonance: number,
    drive = 0,
    slope: 12 | 24 = 12,
    mode: FilterMode = 'lp',
  ): number {
    this.updateCoeff(cutoffHz);

    let u = x;
    if (drive > 0) {
      const gain = 1 + drive * 8;
      u = Math.tanh(u * gain) / Math.tanh(gain > 1 ? gain * 0.5 : 1);
    }

    const res = Math.min(Math.max(resonance, 0), 1);
    const k = Math.max(MIN_K, 2 - 2 * res);

    let y = this.step(u, k, mode, 0);
    if (slope === 24) y = this.step(y, k, mode, 1);
    return y;
  }

  private step(x: number, k: number, mode: FilterMode, section: 0 | 1): number {
    const g = this.g;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const ic1 = this.ic1eq[section];
    const ic2 = this.ic2eq[section];

    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;

    this.ic1eq[section] = 2 * v1 - ic1;
    this.ic2eq[section] = 2 * v2 - ic2;

    switch (mode) {
      case 'lp':    return v2;
      case 'bp':    return v1;
      case 'hp':    return x - k * v1 - v2;
      case 'notch': return x - k * v1;
    }
  }
}
