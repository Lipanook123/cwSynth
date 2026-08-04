import type { OperatorParams } from './Types';
import { scheduleEnvelope, scheduleRelease, releaseDuration } from './Envelope';

/**
 * Modulation index at operator level 1.0. The DX-7 tops out around 12; 10 keeps
 * a little headroom while still reaching the screaming end of the range.
 */
export const MAX_FM_INDEX = 10;

/** Self-feedback is a self-modulation index — smaller range than cross-modulation. */
export const MAX_FEEDBACK_INDEX = 2.5;

/**
 * Operator level → FM modulation index.
 *
 * Deliberately curved: a linear knob would put every usable timbre in the
 * bottom fifth of its travel. Exponent is the one number to turn if the
 * brightness range feels wrong across the board.
 */
export function levelToIndex(level: number): number {
  if (level <= 0) return 0;
  return MAX_FM_INDEX * Math.pow(Math.min(1, level), 2.5);
}

/**
 * A single operator.
 *
 * Signal path:  osc → envGain (envelope, unit scale) → unitOut
 *
 * `unitOut` deliberately carries a 0..1 envelope with NO level applied. Voice
 * builds the stage after it — a gain of `level` when the operator is a carrier,
 * or a gain of `index × frequency` when it modulates something. Keeping level
 * out of the operator is what stops it being applied twice (the old code scaled
 * both the envelope peak and a downstream gain by `level`, making modulator
 * depth level², so a level of 0.5 gave a quarter of the expected depth).
 */
export class Operator {
  private ctx: AudioContext;
  private osc: OscillatorNode | null = null;
  private envGain: GainNode;        // envelope, 0..1
  private feedbackGain: GainNode;   // self-feedback depth in Hz
  private feedbackDelay: DelayNode;
  public  unitOut: GainNode;        // post-envelope, pre-level
  private periodicWave: PeriodicWave | null = null;

  // Karplus-Strong nodes
  private ksNoise: AudioBufferSourceNode | null = null;
  private ksDelay: DelayNode | null = null;
  private ksFilter: BiquadFilterNode | null = null;
  private ksFeedback: GainNode | null = null;

  private params: OperatorParams;
  private active = false;
  private semitone = 60;
  private velocity = 1;
  /** The frequency this operator is actually running at — drives index scaling. */
  private freqHz = 440;

  constructor(ctx: AudioContext, params: OperatorParams) {
    this.ctx = ctx;
    this.params = { ...params };

    this.envGain = ctx.createGain(); this.envGain.gain.value = 0;
    this.unitOut = ctx.createGain(); this.unitOut.gain.value = 1;

    this.feedbackGain  = ctx.createGain(); this.feedbackGain.gain.value = 0;
    this.feedbackDelay = ctx.createDelay(0.001); this.feedbackDelay.delayTime.value = 0.0001;

    // Self-feedback loop: envGain → delay → gain → osc.frequency (wired at noteOn)
    this.envGain.connect(this.feedbackDelay);
    this.feedbackDelay.connect(this.feedbackGain);

    this.envGain.connect(this.unitOut);
  }

  /** Frequency this operator runs at for a given note. */
  frequencyFor(hz: number): number {
    const p = this.params;
    return p.fixed ? p.fixedFreq : hz * p.ratio * Math.pow(2, p.fine / 1200);
  }

  /** Current running frequency — used by Voice to scale FM index into Hz. */
  getFrequency(): number { return this.freqHz; }

  updateParams(params: Partial<OperatorParams>) {
    Object.assign(this.params, params);
    const t = this.ctx.currentTime;
    this.feedbackGain.gain.setValueAtTime(this._feedbackHz(), t);
    if (this.osc && !this.params.karplusStrong) {
      if (this.periodicWave && this.params.wave === 'wavetable') {
        this.osc.setPeriodicWave(this.periodicWave);
      } else if (this.params.wave !== 'wavetable') {
        this.osc.type = this.params.wave as OscillatorType;
      }
    }
  }

  setWavetable(data: number[]) {
    const len = data.length;
    const real = new Float32Array(len / 2);
    const imag = new Float32Array(len / 2);
    // DFT the time-domain data into real/imag partials
    for (let k = 0; k < len / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < len; n++) {
        const phi = (2 * Math.PI * k * n) / len;
        re += data[n] * Math.cos(phi);
        im -= data[n] * Math.sin(phi);
      }
      real[k] = re / len;
      imag[k] = im / len;
    }
    this.periodicWave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /**
   * Self-feedback depth in Hz. Scaled by the operator's own frequency so the
   * timbre holds across the keyboard — the old flat `feedback × 200` was a huge
   * index on a 55 Hz bass note and inaudible at 880 Hz.
   */
  private _feedbackHz(): number {
    return this.params.feedback * MAX_FEEDBACK_INDEX * this.freqHz;
  }

  noteOn(hz: number, velocity: number, semitone: number, startTime: number) {
    this.noteOff(startTime, true);
    this.active = true;
    this.semitone = semitone;
    this.velocity = velocity;
    const t = startTime;
    const p = this.params;

    this.freqHz = this.frequencyFor(hz);

    if (p.karplusStrong) {
      this._startKS(hz, velocity, t);
      return;
    }

    this.osc = this.ctx.createOscillator();
    this.osc.frequency.value = this.freqHz;

    if (p.wave === 'wavetable' && this.periodicWave) {
      this.osc.setPeriodicWave(this.periodicWave);
    } else {
      this.osc.type = (p.wave === 'wavetable' ? 'sine' : p.wave) as OscillatorType;
    }

    this.osc.connect(this.envGain);
    this.feedbackGain.connect(this.osc.frequency);
    this.feedbackGain.gain.setValueAtTime(this._feedbackHz(), t);
    this.osc.start(t);

    // Envelope drives the unit-scale gain. Peak is 1 — level is applied by Voice.
    scheduleEnvelope(this.envGain.gain, p.env, t, 1, velocity, semitone);
  }

  /** Returns the time at which this operator has finished sounding. */
  noteOff(time: number, immediate = false): number {
    if (!this.active && !immediate) return time;
    this.active = false;
    const p = this.params;

    if (this.ksNoise) {
      try { this.ksNoise.stop(time + 0.05); } catch {}
      this.ksNoise = null;
    }

    if (!this.osc) return time;
    const osc = this.osc;
    this.osc = null;

    let endTime: number;
    if (immediate) {
      const g = this.envGain.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(0, time);
      endTime = time + 0.003;
    } else {
      endTime = scheduleRelease(this.envGain.gain, p.env, time, 1, this.velocity, this.semitone);
    }

    try { osc.stop(endTime + 0.05); } catch {}
    return endTime;
  }

  /** How long this operator's release lasts, for voice teardown scheduling. */
  releaseTime(): number {
    return releaseDuration(this.params.env, this.semitone);
  }

  private _startKS(hz: number, velocity: number, t: number) {
    const bufLen = Math.max(2, Math.round(this.ctx.sampleRate / hz));
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    this.ksNoise = this.ctx.createBufferSource();
    this.ksNoise.buffer = buf;

    this.ksDelay = this.ctx.createDelay(1);
    this.ksDelay.delayTime.value = 1 / hz;

    this.ksFilter = this.ctx.createBiquadFilter();
    this.ksFilter.type = 'lowpass';
    this.ksFilter.frequency.value = (hz * 3) + 200;

    this.ksFeedback = this.ctx.createGain();
    this.ksFeedback.gain.value = this.params.ksDecay;

    // KS loop: delay → filter → feedback → delay
    this.ksNoise.connect(this.ksDelay);
    this.ksDelay.connect(this.ksFilter);
    this.ksFilter.connect(this.ksFeedback);
    this.ksFeedback.connect(this.ksDelay);
    this.ksFilter.connect(this.envGain);

    // KS has its own decay, so the amplitude envelope just opens the gate.
    this.envGain.gain.cancelScheduledValues(t);
    this.envGain.gain.setValueAtTime(velocity, t);
    this.ksNoise.start(t);
    this.ksNoise.stop(t + 4); // KS decays naturally; hard stop as a safety net
  }

  /**
   * The oscillator's frequency AudioParam, or null when there is no oscillator
   * (before noteOn, or in Karplus-Strong mode).
   *
   * Returning null rather than falling back to a gain param is deliberate: the
   * old `?? this.oscGain.gain` fallback meant every algorithm silently routed
   * modulators into the target's *amplitude* instead of its frequency, so the
   * synth did AM for its entire life. Callers must handle null.
   */
  getFrequencyParam(): AudioParam | null {
    return this.osc?.frequency ?? null;
  }

  getEnvParam(): AudioParam { return this.envGain.gain; }

  dispose() {
    this.noteOff(this.ctx.currentTime, true);
    try { this.envGain.disconnect(); } catch {}
    try { this.unitOut.disconnect(); } catch {}
    try { this.feedbackGain.disconnect(); } catch {}
    try { this.feedbackDelay.disconnect(); } catch {}
  }
}
