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

  /** Per-sample pitch drift multiplier, updated on a slow random walk. */
  private updateDrift(drift: number): number {
    if (drift <= 0) return 1;
    if (this.driftCounter <= 0) {
      this.driftTarget = (Math.random() * 2 - 1) * drift * MAX_DRIFT_CENTS;
      // New target every 50–150 ms; slow enough to read as instability, not vibrato.
      this.driftCounter = Math.floor(this.sampleRate * (0.05 + Math.random() * 0.1));
    }
    this.driftCounter--;
    this.driftValue += (this.driftTarget - this.driftValue) * 0.0002;
    return Math.pow(2, this.driftValue / 1200);
  }

  /**
   * One sample, in −1..1.
   *
   * @param freqHz     frequency; negative values run the phase backwards, which
   *                   is what deep FM through zero should do
   * @param shape      waveform
   * @param pulseWidth 0..1, only meaningful for `pulse`
   * @param drift      0..1 analog pitch instability
   */
  process(freqHz: number, shape: OscShape = 'sawtooth', pulseWidth = 0.5, drift = 0): number {
    const freq = freqHz * this.updateDrift(drift);
    const nyquist = this.sampleRate * 0.5;
    const clamped = Math.max(-nyquist, Math.min(nyquist, freq));
    const dt = clamped / this.sampleRate;

    this.phase += dt;
    // Wrap into 0..1. Handles negative frequency without a branchy loop.
    this.phase -= Math.floor(this.phase);

    const absDt = Math.abs(dt);
    let out: number;

    switch (shape) {
      case 'sine':
        out = Math.sin(TWO_PI * this.phase);
        break;

      case 'sawtooth': {
        // Naive ramp, then correct the wrap discontinuity.
        out = 2 * this.phase - 1;
        out -= polyBlep(this.phase, absDt);
        break;
      }

      case 'pulse': {
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

      case 'triangle': {
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
