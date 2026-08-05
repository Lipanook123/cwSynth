// Worklet wrapper around the ladder and state-variable filter DSP.
//
// Deliberately thin: all the maths lives in ../dsp/, where it can be tested over
// sample buffers without a browser. This file only maps AudioParams onto it.

import { LadderFilter, type FilterMode } from '../dsp/LadderFilter';
import { StateVariableFilter } from '../dsp/StateVariableFilter';
import { Retirement } from './retire';

const MODES: FilterMode[] = ['lp', 'hp', 'bp', 'notch'];

class LadderFilterProcessor extends AudioWorkletProcessor {
  private ladder: LadderFilter[] = [];
  private svf: StateVariableFilter[] = [];
  private retire = new Retirement(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.retire.onMessage(e.data);
  }

  static get parameterDescriptors() {
    return [
      // a-rate: the filter envelope and any LFO routed to cutoff connect
      // straight to these, so they must move per sample or sweeps zipper.
      { name: 'cutoff', defaultValue: 2000, minValue: 10, maxValue: 22000, automationRate: 'a-rate' as const },
      { name: 'resonance', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' as const },
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' as const },
      // 0 = ladder, 1 = state-variable
      { name: 'model', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' as const },
      // index into MODES
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' as const },
      { name: 'slope', defaultValue: 24, minValue: 12, maxValue: 24, automationRate: 'k-rate' as const },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    if (this.retire.expired(currentTime)) return false;

    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const cutoff = params.cutoff;
    const resonance = params.resonance;
    const drive = params.drive[0];
    const useSvf = params.model[0] >= 0.5;
    const mode = MODES[Math.round(params.mode[0])] ?? 'lp';
    const slope: 12 | 24 = params.slope[0] < 18 ? 12 : 24;

    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      // Silent input still has to be processed: at high resonance the filter
      // self-oscillates, and that is a sound, not an absence of one.
      const inp = input && input[ch] ? input[ch] : null;

      if (!this.ladder[ch]) {
        this.ladder[ch] = new LadderFilter(sampleRate);
        this.svf[ch] = new StateVariableFilter(sampleRate);
      }
      const ladder = this.ladder[ch];
      const svf = this.svf[ch];

      for (let i = 0; i < out.length; i++) {
        const x = inp ? inp[i] : 0;
        const fc = cutoff.length > 1 ? cutoff[i] : cutoff[0];
        const q = resonance.length > 1 ? resonance[i] : resonance[0];
        out[i] = useSvf
          ? svf.process(x, fc, q, drive, slope, mode)
          : ladder.process(x, fc, q, drive, slope, mode);
      }
    }

    // Retiring on silence rather than only on schedule is what keeps a voice's
    // filter from rendering through the half second between the end of its
    // release and its teardown timer. A resonant filter still ringing is not
    // silent, so a ring-out is never cut short by this.
    return !this.retire.observe(output[0]);
  }
}

registerProcessor('cw-ladder-filter', LadderFilterProcessor);
