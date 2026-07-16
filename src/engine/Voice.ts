import { Operator } from './Operator';
import { ALGORITHMS } from './Algorithms';
import { PatchParams, FilterParams } from './Types';

export class Voice {
  private ctx: AudioContext;
  public output: GainNode;
  private operators: Operator[];
  private filter: BiquadFilterNode;
  private filterEnvGain: GainNode;
  private filterActive = false;
  private driveNode: WaveShaperNode;
  private driveGain: GainNode;
  private dryGain: GainNode;
  public semitone: number;
  public noteHz: number;
  private patch: PatchParams;
  private freqConnections: Array<[number, number]> = []; // [source op idx, target op idx]

  constructor(ctx: AudioContext, patch: PatchParams, semitone: number, hz: number) {
    this.ctx = ctx;
    this.patch = patch;
    this.semitone = semitone;
    this.noteHz = hz;

    this.output = ctx.createGain();
    this.output.gain.value = patch.volume;

    // Per-voice drive (soft saturation insert)
    this.driveNode = ctx.createWaveShaper();
    this.driveNode.oversample = '2x';
    this._updateDriveCurve(1);
    this.driveGain = ctx.createGain(); this.driveGain.gain.value = 0;
    this.dryGain   = ctx.createGain(); this.dryGain.gain.value = 1;

    // Filter
    this.filter = ctx.createBiquadFilter();
    this.filterEnvGain = ctx.createGain(); this.filterEnvGain.gain.value = 0;
    this._applyFilterParams(patch.filter);

    // Operators
    this.operators = patch.operators.map(op => new Operator(ctx, op));

    // Signal chain: ops → filter chain → drive → output
    // operators connect directly based on algorithm
    this._buildRouting();
  }

  private _buildRouting() {
    const algo = ALGORITHMS.find(a => a.id === this.patch.algorithm) ?? ALGORITHMS[0];

    // Disconnect previous
    this.operators.forEach(op => op.disconnectOutput());
    this.freqConnections.forEach(([, tgt]) => {
      // disconnected implicitly when output is disconnected
    });
    this.freqConnections = [];

    // Mix node for all carriers
    const carrierMix = this.ctx.createGain();
    carrierMix.gain.value = 1;

    // Connect modulators → target operator frequency inputs
    for (const [tgt, src] of algo.modulators) {
      if (!this.patch.operators[src]?.enabled) continue;
      // FM amount = outputGain scaled by noteHz (standard FM: index = modAmt / carrierFreq)
      // We set outputGain per-operator in noteOn
      this.operators[src].connectToFrequency(this.operators[tgt]);
      this.freqConnections.push([src, tgt]);
    }

    // Carriers → mix
    for (const ci of algo.carriers) {
      if (!this.patch.operators[ci]?.enabled) continue;
      this.operators[ci].connectToOutput(carrierMix);
    }

    // carrierMix → filter (or bypass) → drive → output
    const fp = this.patch.filter;
    if (fp.enabled) {
      carrierMix.connect(this.filter);
      carrierMix.connect(this.dryGain);   // dry path parallel (0 gain when filter active)
      this.dryGain.gain.value = 0;
      this.filter.connect(this.driveGain);
      this.driveGain.connect(this.driveNode);
      this.driveNode.connect(this.output);
      this.filter.connect(this.output);   // also connect directly for mix
    } else {
      carrierMix.connect(this.driveGain);
      this.driveGain.connect(this.driveNode);
      this.driveNode.connect(this.output);
      carrierMix.connect(this.output);
    }
  }

  private _applyFilterParams(fp: FilterParams) {
    this.filter.type = fp.type;
    this.filter.frequency.value = fp.cutoff;
    this.filter.Q.value = fp.resonance;
  }

  private _updateDriveCurve(drive: number) {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (Math.PI + drive) * x / (Math.PI + drive * Math.abs(x));
    }
    this.driveNode.curve = curve;
  }

  noteOn(velocity: number, time: number) {
    const hz = this.noteHz;
    const p = this.patch;
    const algo = ALGORITHMS.find(a => a.id === p.algorithm) ?? ALGORITHMS[0];

    p.operators.forEach((op, i) => {
      if (!op.enabled) return;
      // FM index: modulator output scaled to produce meaningful modulation
      // Standard DX7: outputLevel is in Hz (= ratio * carrierHz * index)
      // We expose it as the operator's level × hz factor
      const isCarrier = algo.carriers.includes(i);
      const scaledVelocity = isCarrier ? velocity : velocity * op.level;
      this.operators[i].updateParams(op);
      this.operators[i].noteOn(hz, scaledVelocity, time);
    });

    // Filter envelope
    if (p.filter.enabled) {
      const fp = p.filter;
      const baseCutoff = fp.cutoff * Math.pow(2, fp.keytrack * (this.semitone - 60) / 12);
      const envRange = baseCutoff * Math.pow(2, fp.envAmount * 4) - baseCutoff;
      const fc = this.filter.frequency;
      fc.cancelScheduledValues(time);
      fc.setValueAtTime(baseCutoff, time);
      fc.linearRampToValueAtTime(baseCutoff + envRange, time + fp.attack);
      fc.linearRampToValueAtTime(baseCutoff + envRange * fp.sustain, time + fp.attack + fp.decay);
    }
  }

  noteOff(time: number) {
    const p = this.patch;
    this.operators.forEach((op, i) => {
      if (!p.operators[i].enabled) return;
      op.noteOff(time);
    });

    // Filter release
    if (p.filter.enabled) {
      const fc = this.filter.frequency;
      fc.cancelScheduledValues(time);
      fc.setValueAtTime(fc.value, time);
      fc.linearRampToValueAtTime(p.filter.cutoff, time + p.filter.release);
    }

    // Fade output at longest release
    const maxRel = Math.max(...p.operators.map(o => o.release));
    const g = this.output.gain;
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + maxRel + 0.05);
  }

  dispose() {
    this.operators.forEach(op => op.dispose());
    try { this.output.disconnect(); } catch {}
    try { this.filter.disconnect(); } catch {}
    try { this.driveNode.disconnect(); } catch {}
  }

  isExpired(time: number): boolean {
    // Check if all operators have finished
    const maxRel = Math.max(...this.patch.operators.map(o => o.release));
    return time > this._noteOffTime + maxRel + 0.1;
  }

  private _noteOffTime = 0;
  recordNoteOff(time: number) { this._noteOffTime = time; }
}
