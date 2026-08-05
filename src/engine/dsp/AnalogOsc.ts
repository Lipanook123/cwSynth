// Analog-style oscillator with PolyBLEP anti-aliasing.
//
// Web Audio's OscillatorNode is band-limited and clean, but it cannot do three
// things this needs: pulse-width modulation, hard sync (its phase is not
// reachable), and a free-running start phase. All three are central to the
// Jupiter-8 and OB-Xa, so the oscillator has to be built by hand.
//
// A naive saw or pulse aliases badly — every discontinuity scatters energy above
// Nyquist that folds back as inharmonic tones. PolyBLEP corrects the samples
// either side of each discontinuity, which removes most of it for a couple of
// arithmetic operations per sample.
//
// Pure DSP, no Web Audio; the worklet is a thin wrapper.

export type OscShape = 'sawtooth' | 'pulse' | 'triangle' | 'sine';

const TWO_PI = Math.PI * 2;

/** Pulse width is clamped away from the extremes, where the wave would vanish. */
const MIN_PW = 0.02;
const MAX_PW = 0.98;

/** Drift depth at drift = 1, in cents. Real analog oscillators wander a few cents. */
const MAX_DRIFT_CENTS = 12;

/**
 * Samples between recomputes of the drift cents→ratio conversion. See updateDrift.
 *
 * Measured over a minute of audio per oscillator, against the implementation
 * this replaced: 205 ms → 74 ms for a drifting saw, and the same ~2.7x for every
 * other shape. With drift switched off it is about 12 ms per oscillator-minute
 * slower than before — the reason was not found, and at 0.02% of a core per
 * oscillator it did not justify more looking, especially as every analog preset
 * here runs drift between 0.25 and 0.5.
 */
const DRIFT_RECALC = 32;

/**
 * Waveform as a small integer.
 *
 * The worklet's `shape` AudioParam is already a number; it used to be turned
 * back into a string so `process` could switch on it, once per sample. Switching
 * on the integer skips that entirely and compiles to a jump table.
 */
export const SHAPE_INDEX: Record<OscShape, number> = {
  sawtooth: 0, pulse: 1, triangle: 2, sine: 3,
};

const SAW = SHAPE_INDEX.sawtooth;
const PULSE = SHAPE_INDEX.pulse;
const TRIANGLE = SHAPE_INDEX.triangle;

/**
 * PolyBLEP correction around a discontinuity.
 *
 * `t` is the phase (0..1) and `dt` the per-sample phase increment. Within one
 * sample either side of the wrap the value is replaced by a polynomial that
 * approximates a band-limited step.
 */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * PolyBLAMP — the same idea for a discontinuity in *slope* rather than value.
 * A triangle's corners are slope breaks, so BLEP does nothing for them.
 */
function polyBlamp(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt - 1;
    return -(x * x * x) / 3;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt + 1;
    return (x * x * x) / 3;
  }
  return 0;
}

export class AnalogOsc {
  private phase: number;
  private sampleRate: number;

  /** Slow random walk on pitch, the thing that stops stacked voices sounding identical. */
  private driftValue = 0;
  private driftTarget = 0;
  private driftCounter = 0;
  /** Cached cents→ratio conversion, and how many samples until it is redone. */
  private driftRatio = 1;
  private driftRatioAge = 0;

  /** Previous sync input sample, for rising-edge detection. */
  private lastSyncIn = 0;

  constructor(sampleRate = 48000, randomPhase = true) {
    this.sampleRate = sampleRate;
    // Free-running start phase. OscillatorNode always starts at 0, which makes
    // every note phase-coherent and is a real part of why stacked digital
    // oscillators sound static compared to analog ones.
    this.phase = randomPhase ? Math.random() : 0;
  }

  setSampleRate(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  reset(randomPhase = true) {
    this.phase = randomPhase ? Math.random() : 0;
    this.lastSyncIn = 0;
  }

  /** Hard sync: restart the waveform, as a master oscillator's cycle would. */
  syncReset() {
    this.phase = 0;
  }

  /**
   * Detect a rising zero-crossing on the sync input and reset if found.
   * Returns true when a reset happened.
   */
  processSync(syncIn: number): boolean {
    const rising = this.lastSyncIn <= 0 && syncIn > 0;
    this.lastSyncIn = syncIn;
    if (rising) {
      this.syncReset();
      return true;
    }
    return false;
  }

  /**
   * Per-sample pitch drift multiplier, updated on a slow random walk.
   *
   * The walk itself is a multiply-add and stays per sample. Converting cents to
   * a frequency ratio is a `Math.pow`, which is not: it was the single most
   * expensive operation in the whole oscillator, run 48,000 times a second per
   * oscillator, and with three oscillators per voice and unison on top it was
   * measurably the difference between a pad keeping up and not.
   *
   * Recomputing it every DRIFT_RECALC samples is inaudible. The walk moves by
   * 0.0002 of its remaining gap per sample, so across 32 samples the ratio can
   * change by at most 0.64% of a gap that is itself at most 12 cents — under a
   * ten-thousandth of a semitone.
   */
  private updateDrift(drift: number): number {
    if (this.driftCounter <= 0) {
      this.driftTarget = (Math.random() * 2 - 1) * drift * MAX_DRIFT_CENTS;
      // New target every 50–150 ms; slow enough to read as instability, not vibrato.
      this.driftCounter = Math.floor(this.sampleRate * (0.05 + Math.random() * 0.1));
    }
    this.driftCounter--;
    this.driftValue += (this.driftTarget - this.driftValue) * 0.0002;

    if (--this.driftRatioAge <= 0) {
      this.driftRatio = Math.pow(2, this.driftValue / 1200);
      this.driftRatioAge = DRIFT_RECALC;
    }
    return this.driftRatio;
  }

  /**
   * One sample, in −1..1.
   *
   * @param freqHz     frequency; negative values run the phase backwards, which
   *                   is what deep FM through zero should do
   * @param shape      waveform, as a `SHAPE_INDEX` value.
   *
   *   Deliberately a number and not `OscShape | number`. Accepting either made
   *   this 2.5x slower with drift off: a union-typed parameter in the hottest
   *   function in the engine costs V8 its specialisation, and the lost inlining
   *   dwarfed what the numeric dispatch saved. Callers with a name in hand
   *   convert once, outside the loop, via SHAPE_INDEX.
   *
   * @param pulseWidth 0..1, only meaningful for `pulse`
   * @param drift      0..1 analog pitch instability
   */
  process(freqHz: number, shape: number = SAW, pulseWidth = 0.5, drift = 0): number {
    // Checked here rather than inside updateDrift: the drift-free path is the
    // common one, and growing that function pushed it out of V8's inlining
    // budget — so an early `return 1` still cost a call on every sample.
    const freq = drift > 0 ? freqHz * this.updateDrift(drift) : freqHz;
    const nyquist = this.sampleRate * 0.5;
    const clamped = Math.max(-nyquist, Math.min(nyquist, freq));
    const dt = clamped / this.sampleRate;

    this.phase += dt;
    // Wrap into 0..1. Handles negative frequency without a branchy loop.
    this.phase -= Math.floor(this.phase);

    const absDt = Math.abs(dt);
    let out: number;

    switch (shape) {
      case SAW:
        // Naive ramp, then correct the wrap discontinuity.
        out = 2 * this.phase - 1;
        out -= polyBlep(this.phase, absDt);
        break;

      case PULSE: {
        const pw = Math.min(MAX_PW, Math.max(MIN_PW, pulseWidth));
        out = this.phase < pw ? 1 : -1;
        // A pulse has two discontinuities per cycle: one at wrap, one at the
        // width point. Both need correcting or PWM whistles with alias tones.
        out += polyBlep(this.phase, absDt);
        let t2 = this.phase - pw;
        t2 -= Math.floor(t2);
        out -= polyBlep(t2, absDt);
        break;
      }

      case TRIANGLE: {
        // Direct form rather than integrating a square: integration accumulates
        // DC and overshoots during the settling transient, and this is exactly
        // ±1 by construction with no state to drift.
        out = 4 * Math.abs(this.phase - 0.5) - 1;
        // Corners are slope discontinuities of ∓8 per unit phase, so they need
        // BLAMP; BLEP would do nothing here since the value is continuous.
        out -= 8 * absDt * polyBlamp(this.phase, absDt);
        let t2 = this.phase - 0.5;
        t2 -= Math.floor(t2);
        out += 8 * absDt * polyBlamp(t2, absDt);
        break;
      }

      default: // SHAPE_INDEX.sine
        out = Math.sin(TWO_PI * this.phase);
        break;
    }

    return out;
  }
}

/** White or pink noise, for the noise operator role. */
export class NoiseGen {
  private b = [0, 0, 0, 0, 0, 0, 0];

  white(): number {
    return Math.random() * 2 - 1;
  }

  /**
   * Pink noise via Paul Kellet's economical filter — −3 dB/octave, which is what
   * makes it read as "wind" or "surf" rather than the hiss of white noise.
   */
  pink(): number {
    const w = this.white();
    this.b[0] = 0.99886 * this.b[0] + w * 0.0555179;
    this.b[1] = 0.99332 * this.b[1] + w * 0.0750759;
    this.b[2] = 0.96900 * this.b[2] + w * 0.1538520;
    this.b[3] = 0.86650 * this.b[3] + w * 0.3104856;
    this.b[4] = 0.55000 * this.b[4] + w * 0.5329522;
    this.b[5] = -0.7616 * this.b[5] - w * 0.0168980;
    const out = this.b[0] + this.b[1] + this.b[2] + this.b[3] + this.b[4] + this.b[5] + this.b[6] + w * 0.5362;
    this.b[6] = w * 0.115926;
    return out * 0.11;
  }
}
