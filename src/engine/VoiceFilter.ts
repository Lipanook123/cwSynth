// The per-voice filter chain, hiding which model is in use behind one interface.
//
//   input → [series HPF] → [biquad | ladder worklet] → output
//
// Voice binds its envelope and mod-matrix targets to `cutoffParam` and
// `resonanceParam` and never has to know whether it is driving a BiquadFilterNode
// or an AudioWorkletNode — both expose ordinary AudioParams, which is what makes
// the swap invisible to everything upstream.

import type { FilterParams, FilterType } from './Types';
import { LADDER_PROCESSOR, workletsReady } from './worklets';

/** Mode indices as ordered in ladder.worklet.ts. */
const MODE_INDEX: Record<FilterType, number> = {
  lowpass: 0, highpass: 1, bandpass: 2, notch: 3,
};

/** Biquad Q tops out at 30; the worklets take resonance normalised to 0..1. */
const MAX_BIQUAD_Q = 30;

/** Below this the series highpass is bypassed entirely. */
const HPF_OFF_BELOW = 25;

/**
 * `resonance` is stored per patch on the biquad's 0..30 Q scale for backwards
 * compatibility. The worklets want 0..1 with self-oscillation at the top, so
 * map on the way in rather than forking the schema.
 */
export function normaliseResonance(resonance: number): number {
  return Math.min(1, Math.max(0, resonance / MAX_BIQUAD_Q));
}

export class VoiceFilter {
  readonly input: GainNode;
  readonly output: GainNode;

  private hpf: BiquadFilterNode | null = null;
  private biquad: BiquadFilterNode | null = null;
  private worklet: AudioWorkletNode | null = null;

  /** True when the ladder/svf worklet is actually in use (not the fallback). */
  readonly usingWorklet: boolean;

  constructor(ctx: AudioContext, params: FilterParams) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    const wantsWorklet = params.model !== 'biquad';
    this.usingWorklet = wantsWorklet && workletsReady(ctx);

    // Jupiter-8 topology: a non-resonant highpass ahead of the main filter.
    let head: AudioNode = this.input;
    if (params.hpfCutoff > HPF_OFF_BELOW) {
      this.hpf = ctx.createBiquadFilter();
      this.hpf.type = 'highpass';
      this.hpf.frequency.value = params.hpfCutoff;
      this.hpf.Q.value = 0.7; // non-resonant
      this.input.connect(this.hpf);
      head = this.hpf;
    }

    if (this.usingWorklet) {
      this.worklet = new AudioWorkletNode(ctx, LADDER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const p = this.worklet.parameters;
      p.get('cutoff')!.value = params.cutoff;
      p.get('resonance')!.value = normaliseResonance(params.resonance);
      p.get('drive')!.value = params.drive;
      p.get('model')!.value = params.model === 'svf' ? 1 : 0;
      p.get('mode')!.value = MODE_INDEX[params.type] ?? 0;
      p.get('slope')!.value = params.slope;
      head.connect(this.worklet);
      this.worklet.connect(this.output);
    } else {
      // Either the patch asked for biquad, or the worklet has not loaded yet.
      // Falling back keeps the patch audible rather than silent.
      this.biquad = ctx.createBiquadFilter();
      this.biquad.type = params.type;
      this.biquad.frequency.value = params.cutoff;
      this.biquad.Q.value = params.resonance;
      head.connect(this.biquad);
      this.biquad.connect(this.output);
    }
  }

  /**
   * Cutoff in Hz. Envelope and LFO signals connect here and sum with the base
   * value, exactly as they did when this was always a BiquadFilterNode.
   */
  get cutoffParam(): AudioParam {
    return this.worklet
      ? this.worklet.parameters.get('cutoff')!
      : this.biquad!.frequency;
  }

  /** Resonance. Scale differs by model — see `resonanceModScale`. */
  get resonanceParam(): AudioParam {
    return this.worklet
      ? this.worklet.parameters.get('resonance')!
      : this.biquad!.Q;
  }

  /**
   * How far a unit modulator should swing resonance, given the patch value.
   * The worklets run 0..1 while the biquad runs 0..30, so a mod slot means the
   * same musical amount on both.
   */
  resonanceModScale(patchResonance: number): number {
    return this.worklet ? normaliseResonance(patchResonance) : patchResonance;
  }

  setCutoff(hz: number, time: number) {
    this.cutoffParam.setValueAtTime(hz, time);
  }

  dispose() {
    try { this.input.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
    try { this.hpf?.disconnect(); } catch {}
    try { this.biquad?.disconnect(); } catch {}
    if (this.worklet) {
      // Disconnecting is not enough: the processor keeps running until it is
      // told to retire, so it must be stopped explicitly or it leaks per voice.
      try { this.worklet.port.postMessage({ type: 'stop' }); } catch {}
      try { this.worklet.disconnect(); } catch {}
      this.worklet = null;
    }
  }
}
