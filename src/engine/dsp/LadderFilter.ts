// Moog-style transistor ladder filter, zero-delay-feedback (TPT) topology.
//
// Four one-pole stages in cascade with a global feedback path. The ZDF solve is
// exact for the linear case, so cutoff and slope land where they should; the
// state feeding the feedback path is soft-limited, which bounds self-oscillation
// without touching small-signal response.
//
// This is the sound a cascaded pair of BiquadFilterNodes cannot produce:
// self-oscillation at high resonance, the characteristic bass loss as resonance
// rises, and saturation when driven.
//
// Pure DSP, no Web Audio — the worklet is a thin wrapper (worklets/ladder.worklet.ts)
// and the tests run this directly over sample buffers.

export type FilterMode = 'lp' | 'hp' | 'bp' | 'notch';

/**
 * Feedback at which the 4-pole ladder breaks into self-oscillation. Resonance
 * 1.0 maps slightly past it so the top of the knob reliably sings.
 */
const SELF_OSC_K = 4;
const MAX_K = 4.3;

/** Below this the tanh limiter is within ~1% of unity, so linear response holds. */
const LIMIT_HEADROOM = 1.4;

const MIN_CUTOFF = 10;

/**
 * Oberheim Xpander-style mode mixing: each mode is a linear combination of the
 * ladder input and the four stage outputs. This is how one ladder yields
 * highpass and bandpass responses rather than only lowpass.
 */
const MODE_MIX: Record<string, [number, number, number, number, number]> = {
  // [u, y1, y2, y3, y4]
  lp24:    [0,  0,  0,  0, 1],
  lp12:    [0,  0,  1,  0, 0],
  hp24:    [1, -4,  6, -4, 1],
  hp12:    [1, -2,  1,  0, 0],
  bp24:    [0,  0,  4, -8, 4],
  bp12:    [0,  2, -2,  0, 0],
  notch24: [1, -2,  2,  0, 0],
  notch12: [1, -2,  2,  0, 0],
};

export class LadderFilter {
  private z0 = 0; private z1 = 0; private z2 = 0; private z3 = 0;
  private sampleRate: number;

  // Cached coefficient, recomputed only when cutoff moves — tan() per sample
  // across every voice is the one genuinely hot call in here.
  private cachedCutoff = -1;
  private G = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  setSampleRate(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.cachedCutoff = -1;
    this.reset();
  }

  reset() {
    this.z0 = this.z1 = this.z2 = this.z3 = 0;
    // Not a cutoff reset — coefficients stay valid across a note.
  }

  /** Seed the filter so it can break into self-oscillation from silence. */
  private static readonly SEED = 1e-6;

  private updateCoeff(cutoffHz: number) {
    if (cutoffHz === this.cachedCutoff) return;
    this.cachedCutoff = cutoffHz;
    const nyquist = this.sampleRate * 0.5;
    const fc = Math.min(Math.max(cutoffHz, MIN_CUTOFF), nyquist * 0.98);
    const g = Math.tan((Math.PI * fc) / this.sampleRate);
    this.G = g / (1 + g);
  }

  /**
   * One sample.
   *
   * @param x         input
   * @param cutoffHz  cutoff frequency
   * @param resonance 0..1, self-oscillating at 1
   * @param drive     0..1 input saturation
   * @param slope     12 or 24 dB/oct
   * @param mode      lp | hp | bp | notch
   */
  process(
    x: number,
    cutoffHz: number,
    resonance: number,
    drive = 0,
    slope: 12 | 24 = 24,
    mode: FilterMode = 'lp',
  ): number {
    this.updateCoeff(cutoffHz);
    const G = this.G;
    const k = Math.min(Math.max(resonance, 0), 1) * MAX_K;

    // Input drive. tanh is the saturation curve; at drive 0 this is a no-op.
    let u = x;
    if (drive > 0) {
      const gain = 1 + drive * 8;
      u = Math.tanh(u * gain) / Math.tanh(gain > 1 ? gain * 0.5 : 1);
    }

    // Instantaneous stage responses: y_i = G*x_i + S_i, with S_i = (1-G)*z_i.
    const oneMinusG = 1 - G;
    const S0 = oneMinusG * this.z0;
    const S1 = oneMinusG * this.z1;
    const S2 = oneMinusG * this.z2;
    const S3 = oneMinusG * this.z3;

    const G2 = G * G;
    const G3 = G2 * G;
    const G4 = G3 * G;

    // Zero-delay feedback solve: express y4 in terms of the input and the
    // states, then solve y4 = G^4*(u - k*y4) + sigma for y4 directly. Doing
    // this rather than using last sample's output is what keeps the resonant
    // peak at the right frequency when cutoff is high.
    const sigma = G3 * S0 + G2 * S1 + G * S2 + S3;
    const denom = 1 + k * G4;
    const y4solved = (G4 * u + sigma) / denom;

    // Feedback input to the ladder, plus a tiny seed so self-oscillation can
    // start from perfect silence.
    const drivenIn = u - k * y4solved + LadderFilter.SEED;

    // Propagate through the four TPT one-poles, updating state.
    const y1 = G * drivenIn + S0;
    this.z0 = 2 * y1 - this.z0;

    const y2 = G * y1 + S1;
    this.z1 = 2 * y2 - this.z1;

    const y3 = G * y2 + S2;
    this.z2 = 2 * y3 - this.z2;

    let y4 = G * y3 + S3;
    // Soft-limit the state that feeds the feedback path. Below ~1.4 this is
    // within a percent of unity, so the linear response (and the slope tests)
    // are unaffected; above it, self-oscillation settles instead of diverging.
    this.z3 = 2 * y4 - this.z3;
    if (this.z3 > LIMIT_HEADROOM || this.z3 < -LIMIT_HEADROOM) {
      this.z3 = LIMIT_HEADROOM * Math.tanh(this.z3 / LIMIT_HEADROOM);
    }

    if (mode === 'lp') {
      y4 = slope === 24 ? y4 : y2;
      // Resonance costs low end on a real ladder. Restoring a little keeps
      // high-resonance bass patches usable without erasing the character.
      return y4 * (1 + k * 0.18);
    }

    const mix = MODE_MIX[`${mode}${slope}`] ?? MODE_MIX.lp24;
    return mix[0] * drivenIn + mix[1] * y1 + mix[2] * y2 + mix[3] * y3 + mix[4] * y4;
  }

  /** Feedback at which self-oscillation begins, for tests and documentation. */
  static get selfOscillationK() { return SELF_OSC_K; }
}
