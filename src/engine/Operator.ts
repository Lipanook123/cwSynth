import type { OperatorParams } from './Types';
import { scheduleEnvelope, scheduleRelease, releaseDuration } from './Envelope';
import { ANALOG_OSC_PROCESSOR, workletsReady } from './worklets';
import { NoiseGen } from './dsp/AnalogOsc';

/** Shape indices as ordered in analog-osc.worklet.ts. */
const OSC_SHAPE_INDEX: Record<string, number> = {
  sawtooth: 0, pulse: 1, square: 1, triangle: 2, sine: 3,
};

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
  /** Stock oscillator, used by the `fm` role and as the `vco` fallback. */
  private osc: OscillatorNode | null = null;
  /** Worklet oscillator, used by the `vco` role when worklets are available. */
  private vco: AudioWorkletNode | null = null;
  /** Looping noise buffer, used by the `noise` role. */
  private noise: AudioBufferSourceNode | null = null;
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

  /**
   * Portamento: slide this operator's pitch to the frequency for `toHz`.
   *
   * Works for both source types because a worklet's `frequency` param behaves
   * exactly like an oscillator's. Exponential, so the glide is linear in
   * musical pitch rather than in Hz — a linear ramp from 55 Hz to 880 Hz would
   * spend almost all its time in the top octave.
   *
   * A fixed-frequency operator ignores this, as it ignores the played note.
   */
  /**
   * @param fromHz Optional starting pitch. Omit to glide from wherever the
   *   oscillator currently is, which is what legato needs.
   *
   * Start and ramp are scheduled in one call on purpose: doing it as two
   * (set-start, then glide) meant the glide's own `cancelScheduledValues`
   * wiped the start value, and the note silently began at its destination.
   */
  glideTo(toHz: number, startTime: number, glideTime: number, fromHz?: number) {
    if (this.params.fixed) return;
    const target = this.frequencyFor(toHz);
    const param = this.getFrequencyParam();
    this.freqHz = target;

    if (param) {
      const start = fromHz !== undefined
        ? this.frequencyFor(fromHz)
        : param.value;
      param.cancelScheduledValues(startTime);
      param.setValueAtTime(Math.max(1e-3, start), startTime);
      if (glideTime > 0) {
        param.exponentialRampToValueAtTime(Math.max(1e-3, target), startTime + glideTime);
      } else {
        param.setValueAtTime(target, startTime);
      }
    }

    // Self-feedback depth tracks frequency, so it has to move with the glide.
    this.feedbackGain.gain.setValueAtTime(this._feedbackHz(), startTime + glideTime);
  }

  updateParams(params: Partial<OperatorParams>) {
    Object.assign(this.params, params);
    const t = this.ctx.currentTime;
    this.feedbackGain.gain.setValueAtTime(this._feedbackHz(), t);
    if (this.vco) {
      this.vco.parameters.get('pulseWidth')!.setValueAtTime(this.params.pulseWidth, t);
      this.vco.parameters.get('shape')!.setValueAtTime(OSC_SHAPE_INDEX[this.params.wave] ?? 0, t);
      this.vco.parameters.get('drift')!.setValueAtTime(this.params.drift, t);
    }
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

    if (p.role === 'noise') {
      this._startNoise(t);
    } else if (p.role === 'vco' && workletsReady(this.ctx)) {
      this._startVco();
    } else {
      this._startOscillator(t);
    }

    // Self-feedback binds to whichever source exposes a frequency param.
    const freqParam = this.getFrequencyParam();
    if (freqParam) {
      this.feedbackGain.connect(freqParam);
      this.feedbackGain.gain.setValueAtTime(this._feedbackHz(), t);
    }

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

    const osc = this.osc;
    const vco = this.vco;
    const noise = this.noise;
    this.osc = null;
    this.vco = null;
    this.noise = null;
    if (!osc && !vco && !noise) return time;

    let endTime: number;
    if (immediate) {
      const g = this.envGain.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(0, time);
      endTime = time + 0.003;
    } else {
      endTime = scheduleRelease(this.envGain.gain, p.env, time, 1, this.velocity, this.semitone);
    }

    if (osc) { try { osc.stop(endTime + 0.05); } catch {} }
    if (noise) { try { noise.stop(endTime + 0.05); } catch {} }
    if (vco) {
      // A worklet node has no stop(); tell the processor to retire so it can be
      // collected instead of running silently for the life of the context.
      const stopAt = Math.max(0, (endTime + 0.05 - this.ctx.currentTime) * 1000);
      setTimeout(() => {
        try { vco.port.postMessage({ type: 'stop' }); } catch {}
        try { vco.disconnect(); } catch {}
      }, stopAt);
    }
    return endTime;
  }

  /** How long this operator's release lasts, for voice teardown scheduling. */
  releaseTime(): number {
    return releaseDuration(this.params.env, this.semitone);
  }

  /** Stock band-limited oscillator — the `fm` role, and the `vco` fallback. */
  private _startOscillator(t: number) {
    const p = this.params;
    this.osc = this.ctx.createOscillator();
    this.osc.frequency.value = this.freqHz;

    if (p.wave === 'wavetable' && this.periodicWave) {
      this.osc.setPeriodicWave(this.periodicWave);
    } else {
      this.osc.type = (p.wave === 'wavetable' ? 'sine' : p.wave) as OscillatorType;
    }

    this.osc.connect(this.envGain);
    this.osc.start(t);
  }

  /**
   * Worklet oscillator — PolyBLEP shapes with pulse-width modulation, hard sync
   * and a free-running start phase, none of which OscillatorNode can do.
   */
  private _startVco() {
    const p = this.params;
    this.vco = new AudioWorkletNode(this.ctx, ANALOG_OSC_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.vco.parameters.get('frequency')!.value = this.freqHz;
    this.vco.parameters.get('pulseWidth')!.value = p.pulseWidth;
    this.vco.parameters.get('shape')!.value = OSC_SHAPE_INDEX[p.wave] ?? 0;
    this.vco.parameters.get('drift')!.value = p.drift;
    this.vco.connect(this.envGain);
  }

  /** Looping noise buffer. Two seconds is long enough that the loop is inaudible. */
  private _startNoise(t: number) {
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);

    if (this.params.noiseType === 'pink') {
      const gen = new NoiseGen();
      for (let i = 0; i < len; i++) data[i] = gen.pink();
    } else {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noise.connect(this.envGain);
    this.noise.start(t);
  }

  /** The worklet's sync input, when this operator is a hard-sync target. */
  getSyncInput(): AudioNode | null {
    return this.vco;
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
    if (this.osc) return this.osc.frequency;
    // Worklet AudioParams behave exactly like an oscillator's, which is why FM
    // routing, pitch modulation and self-feedback all work unchanged for VCOs.
    if (this.vco) return this.vco.parameters.get('frequency') ?? null;
    return null;
  }

  /** Pulse width, for PWM modulation. Only VCO operators have one. */
  getPulseWidthParam(): AudioParam | null {
    return this.vco?.parameters.get('pulseWidth') ?? null;
  }

  getEnvParam(): AudioParam { return this.envGain.gain; }

  dispose() {
    this.noteOff(this.ctx.currentTime, true);
    if (this.vco) {
      try { this.vco.port.postMessage({ type: 'stop' }); } catch {}
      try { this.vco.disconnect(); } catch {}
      this.vco = null;
    }
    try { this.envGain.disconnect(); } catch {}
    try { this.unitOut.disconnect(); } catch {}
    try { this.feedbackGain.disconnect(); } catch {}
    try { this.feedbackDelay.disconnect(); } catch {}
  }
}
