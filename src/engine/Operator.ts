import type { OperatorParams, WaveType } from './Types';

export class Operator {
  private ctx: AudioContext;
  private osc: OscillatorNode | null = null;
  private oscGain: GainNode;       // envelope-controlled output
  private feedbackGain: GainNode;  // self-feedback loop
  private feedbackDelay: DelayNode;
  public  outputGain: GainNode;    // to next operator or output
  private envGain: GainNode;       // master level × env
  private periodicWave: PeriodicWave | null = null;

  // KS nodes
  private ksNoise: AudioBufferSourceNode | null = null;
  private ksDelay: DelayNode | null = null;
  private ksFilter: BiquadFilterNode | null = null;
  private ksFeedback: GainNode | null = null;

  private params: OperatorParams;
  private noteHz = 440;
  private active = false;
  private noteOffTime = 0;

  constructor(ctx: AudioContext, params: OperatorParams) {
    this.ctx = ctx;
    this.params = { ...params };

    this.oscGain     = ctx.createGain(); this.oscGain.gain.value = 0;
    this.feedbackGain = ctx.createGain(); this.feedbackGain.gain.value = 0;
    this.feedbackDelay = ctx.createDelay(0.001); this.feedbackDelay.delayTime.value = 0.0001;
    this.envGain     = ctx.createGain(); this.envGain.gain.value = params.level;
    this.outputGain  = ctx.createGain(); this.outputGain.gain.value = 1;

    // Feedback loop: oscGain → feedbackDelay → feedbackGain → osc.frequency (connected on noteOn)
    this.oscGain.connect(this.feedbackDelay);
    this.feedbackDelay.connect(this.feedbackGain);
    // feedbackGain connects to osc.frequency in noteOn

    this.oscGain.connect(this.envGain);
    this.envGain.connect(this.outputGain);
  }

  updateParams(params: Partial<OperatorParams>) {
    Object.assign(this.params, params);
    const t = this.ctx.currentTime;
    this.envGain.gain.setValueAtTime(this.params.level, t);
    this.feedbackGain.gain.setValueAtTime(this.params.feedback * 200, t);
    if (this.osc && !this.params.karplusStrong) {
      this.osc.type = this.params.wave !== 'wavetable' ? this.params.wave as OscillatorType : 'sine';
      if (this.periodicWave && this.params.wave === 'wavetable') {
        this.osc.setPeriodicWave(this.periodicWave);
      }
    }
  }

  setWavetable(data: number[]) {
    const len = data.length;
    const real = new Float32Array(len / 2);
    const imag = new Float32Array(len / 2);
    // FFT the time-domain data into real/imag partials
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

  noteOn(hz: number, velocity: number, startTime: number) {
    this.noteOff(startTime, true);
    this.noteHz = hz;
    this.active = true;
    const t = startTime;
    const p = this.params;

    if (p.karplusStrong) {
      this._startKS(hz, velocity, t);
      return;
    }

    this.osc = this.ctx.createOscillator();
    const freq = p.fixed ? p.fixedFreq : hz * p.ratio * Math.pow(2, p.fine / 1200);
    this.osc.frequency.value = freq;

    if (p.wave === 'wavetable' && this.periodicWave) {
      this.osc.setPeriodicWave(this.periodicWave);
    } else {
      this.osc.type = p.wave as OscillatorType;
    }

    this.osc.connect(this.oscGain);
    this.feedbackGain.connect(this.osc.frequency);
    this.osc.start(t);

    // ADSR on oscGain (amplitude envelope)
    const g = this.oscGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(velocity, t + p.attack);
    g.linearRampToValueAtTime(p.sustain * velocity, t + p.attack + p.decay);

    this.feedbackGain.gain.setValueAtTime(p.feedback * 200, t);
    this.envGain.gain.setValueAtTime(p.level, t);
  }

  noteOff(time: number, immediate = false) {
    if (!this.active && !immediate) return;
    this.active = false;
    this.noteOffTime = time;
    const p = this.params;
    const rel = immediate ? 0.003 : p.release;

    if (this.ksNoise) {
      try { this.ksNoise.stop(time + rel + 0.05); } catch {}
      this.ksNoise = null;
    }

    if (!this.osc) return;
    const osc = this.osc;
    this.osc = null;

    const g = this.oscGain.gain;
    if (!immediate) {
      g.cancelScheduledValues(time);
      g.setValueAtTime(g.value, time);
      g.linearRampToValueAtTime(0, time + rel);
    } else {
      g.cancelScheduledValues(time);
      g.setValueAtTime(0, time);
    }
    try { osc.stop(time + rel + 0.05); } catch {}
  }

  private _startKS(hz: number, velocity: number, t: number) {
    const bufLen = Math.round(this.ctx.sampleRate / hz);
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

    this.envGain.gain.setValueAtTime(velocity * this.params.level, t);
    this.ksNoise.start(t);
    this.ksNoise.stop(t + 4); // KS decays naturally, hard stop safety
  }

  // Connect output to another operator's frequency input (FM routing)
  connectToFrequency(target: Operator) {
    this.outputGain.connect(target.getOscFrequency());
  }

  disconnectFromFrequency(target: Operator) {
    try { this.outputGain.disconnect(target.getOscFrequency()); } catch {}
  }

  getOscFrequency(): AudioParam {
    // Return the frequency AudioParam of the internal oscillator
    // We route FM via a gain node connected at noteOn time
    return (this.osc as OscillatorNode)?.frequency ?? this.oscGain.gain;
  }

  // Connect to audio output (carrier role)
  connectToOutput(dest: AudioNode) {
    this.outputGain.connect(dest);
  }

  disconnectOutput() {
    try { this.outputGain.disconnect(); } catch {}
  }

  dispose() {
    this.noteOff(this.ctx.currentTime, true);
    try { this.oscGain.disconnect(); } catch {}
    try { this.envGain.disconnect(); } catch {}
    try { this.outputGain.disconnect(); } catch {}
    try { this.feedbackGain.disconnect(); } catch {}
  }
}
