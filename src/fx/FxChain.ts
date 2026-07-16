import type { FxParams } from '../engine/Types';

export class FxChain {
  private ctx: AudioContext;
  public input: GainNode;
  public output: GainNode;

  // Reverb
  private reverbConv: ConvolverNode;
  private reverbDry: GainNode;
  private reverbWet: GainNode;

  // Delay
  private delayNode: DelayNode;
  private delayFeedback: GainNode;
  private delayFilter: BiquadFilterNode;
  private delayDry: GainNode;
  private delayWet: GainNode;

  // Chorus
  private chorusDelay1: DelayNode;
  private chorusDelay2: DelayNode;
  private chorusLfo1: OscillatorNode;
  private chorusLfo2: OscillatorNode;
  private chorusLfoGain1: GainNode;
  private chorusLfoGain2: GainNode;
  private chorusDry: GainNode;
  private chorusWet: GainNode;

  // Distortion
  private distWs: WaveShaperNode;
  private distFilter: BiquadFilterNode;
  private distDry: GainNode;
  private distWet: GainNode;

  // EQ
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;

  private params: FxParams;

  constructor(ctx: AudioContext, params: FxParams) {
    this.ctx = ctx;
    this.params = params;

    this.input  = ctx.createGain();
    this.output = ctx.createGain();

    // ── Reverb ──────────────────────────────────────────
    this.reverbConv = ctx.createConvolver();
    this.reverbConv.buffer = this._buildIR(params.reverb.size, params.reverb.damp);
    this.reverbDry  = ctx.createGain();
    this.reverbWet  = ctx.createGain();

    // ── Delay ───────────────────────────────────────────
    this.delayNode     = ctx.createDelay(2);
    this.delayNode.delayTime.value = params.delay.time;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = params.delay.feedback;
    this.delayFilter   = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 4000;
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();

    // ── Chorus ──────────────────────────────────────────
    this.chorusDelay1  = ctx.createDelay(0.05);
    this.chorusDelay2  = ctx.createDelay(0.05);
    this.chorusLfo1    = ctx.createOscillator(); this.chorusLfo1.frequency.value = params.chorus.rate;
    this.chorusLfo2    = ctx.createOscillator(); this.chorusLfo2.frequency.value = params.chorus.rate * 1.07;
    this.chorusLfoGain1 = ctx.createGain(); this.chorusLfoGain1.gain.value = params.chorus.depth * 0.005;
    this.chorusLfoGain2 = ctx.createGain(); this.chorusLfoGain2.gain.value = params.chorus.depth * 0.005;
    this.chorusDry = ctx.createGain();
    this.chorusWet = ctx.createGain();
    this.chorusLfo1.start(); this.chorusLfo2.start();
    this.chorusLfo1.connect(this.chorusLfoGain1); this.chorusLfoGain1.connect(this.chorusDelay1.delayTime);
    this.chorusLfo2.connect(this.chorusLfoGain2); this.chorusLfoGain2.connect(this.chorusDelay2.delayTime);

    // ── Distortion ──────────────────────────────────────
    this.distWs     = ctx.createWaveShaper(); this.distWs.oversample = '4x';
    this.distFilter = ctx.createBiquadFilter(); this.distFilter.type = 'lowpass';
    this.distDry    = ctx.createGain();
    this.distWet    = ctx.createGain();

    // ── EQ ──────────────────────────────────────────────
    this.eqLow  = ctx.createBiquadFilter(); this.eqLow.type  = 'lowshelf';  this.eqLow.frequency.value  = 200;
    this.eqMid  = ctx.createBiquadFilter(); this.eqMid.type  = 'peaking';   this.eqMid.frequency.value  = 1000; this.eqMid.Q.value = 1;
    this.eqHigh = ctx.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 6000;

    this._buildChain();
    this.update(params);
  }

  private _buildChain() {
    // input → eq → dist → chorus → delay → reverb → output
    const nodes = [
      this.eqLow, this.eqMid, this.eqHigh,
    ];
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);

    // Dist (parallel dry/wet)
    this.eqHigh.connect(this.distDry);
    this.eqHigh.connect(this.distWs);
    this.distWs.connect(this.distFilter);
    this.distFilter.connect(this.distWet);
    const distMix = this.ctx.createGain(); distMix.gain.value = 1;
    this.distDry.connect(distMix); this.distWet.connect(distMix);

    // Chorus (parallel)
    distMix.connect(this.chorusDry);
    distMix.connect(this.chorusDelay1);
    distMix.connect(this.chorusDelay2);
    const chorusMix = this.ctx.createGain(); chorusMix.gain.value = 1;
    this.chorusDry.connect(chorusMix);
    this.chorusDelay1.connect(this.chorusWet); this.chorusDelay2.connect(this.chorusWet);
    this.chorusWet.connect(chorusMix);

    // Delay (parallel)
    chorusMix.connect(this.delayDry);
    chorusMix.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayFilter.connect(this.delayWet);
    const delayMix = this.ctx.createGain(); delayMix.gain.value = 1;
    this.delayDry.connect(delayMix); this.delayWet.connect(delayMix);

    // Reverb (parallel)
    delayMix.connect(this.reverbDry);
    delayMix.connect(this.reverbConv);
    this.reverbConv.connect(this.reverbWet);
    this.reverbDry.connect(this.output);
    this.reverbWet.connect(this.output);

    // Input feeds EQ
    this.input.connect(this.eqLow);
  }

  update(params: FxParams) {
    this.params = params;
    const t = this.ctx.currentTime;
    const { reverb, delay, chorus, dist, eq } = params;

    // Reverb
    this.reverbDry.gain.setValueAtTime(1 - reverb.mix * +reverb.enabled, t);
    this.reverbWet.gain.setValueAtTime(reverb.mix * +reverb.enabled, t);

    // Delay
    this.delayNode.delayTime.setValueAtTime(delay.time, t);
    this.delayFeedback.gain.setValueAtTime(delay.feedback, t);
    this.delayDry.gain.setValueAtTime(1 - delay.mix * +delay.enabled, t);
    this.delayWet.gain.setValueAtTime(delay.mix * +delay.enabled, t);

    // Chorus
    this.chorusLfo1.frequency.setValueAtTime(chorus.rate, t);
    this.chorusLfo2.frequency.setValueAtTime(chorus.rate * 1.07, t);
    this.chorusLfoGain1.gain.setValueAtTime(chorus.depth * 0.005, t);
    this.chorusLfoGain2.gain.setValueAtTime(chorus.depth * 0.005, t);
    this.chorusDry.gain.setValueAtTime(1 - chorus.mix * +chorus.enabled, t);
    this.chorusWet.gain.setValueAtTime(chorus.mix * +chorus.enabled * 0.5, t);

    // Distortion
    this._updateDistCurve(dist.drive, dist.mode);
    this.distFilter.frequency.setValueAtTime(dist.tone * 8000 + 500, t);
    this.distDry.gain.setValueAtTime(1 - dist.mix * +dist.enabled, t);
    this.distWet.gain.setValueAtTime(dist.mix * +dist.enabled, t);

    // EQ
    this.eqLow.gain.setValueAtTime(eq.enabled ? eq.low : 0, t);
    this.eqMid.gain.setValueAtTime(eq.enabled ? eq.mid : 0, t);
    this.eqMid.frequency.setValueAtTime(eq.midFreq, t);
    this.eqHigh.gain.setValueAtTime(eq.enabled ? eq.high : 0, t);
  }

  updateReverb(size: number, damp: number) {
    this.reverbConv.buffer = this._buildIR(size, damp);
  }

  private _buildIR(size: number, damp: number): AudioBuffer {
    const len = Math.round(this.ctx.sampleRate * (0.5 + size * 3));
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - damp * 0.0003, i);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2 - size) * decay;
      }
    }
    return buf;
  }

  private _updateDistCurve(drive: number, mode: 'soft' | 'hard' | 'bit') {
    const n = 512;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      if (mode === 'soft') {
        curve[i] = (Math.PI + drive * 8) * x / (Math.PI + drive * 8 * Math.abs(x));
      } else if (mode === 'hard') {
        curve[i] = Math.max(-1, Math.min(1, x * drive * 4));
      } else {
        // bitcrush approx
        const bits = Math.max(1, 8 - drive * 6);
        const step = 2 / Math.pow(2, bits);
        curve[i] = Math.round(x / step) * step;
      }
    }
    this.distWs.curve = curve;
  }

  dispose() {
    this.chorusLfo1.stop(); this.chorusLfo2.stop();
    try { this.input.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}
