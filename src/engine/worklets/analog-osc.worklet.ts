// Worklet wrapper around the analog oscillator DSP.
//
// Input 0 is the hard-sync input: whatever is connected there is watched for a
// rising zero-crossing, and the oscillator restarts its cycle when one arrives.

import { AnalogOsc, type OscShape } from '../dsp/AnalogOsc';
import { Retirement } from './retire';

const SHAPES: OscShape[] = ['sawtooth', 'pulse', 'triangle', 'sine'];

class AnalogOscProcessor extends AudioWorkletProcessor {
  private osc = new AnalogOsc(sampleRate, true);
  private retire = new Retirement(sampleRate);

  constructor() {
    super();
    // The engine stops a voice by telling the processor to retire, so the node
    // can be garbage collected rather than running silently forever.
    this.port.onmessage = (e: MessageEvent) => {
      this.retire.onMessage(e.data);
      if (e.data?.type === 'reset') this.osc.reset(e.data.randomPhase !== false);
    };
  }

  static get parameterDescriptors() {
    return [
      // Negative frequency is allowed on purpose: deep FM drives the carrier
      // through zero, and the phase should run backwards rather than clamp.
      { name: 'frequency', defaultValue: 440, minValue: -22050, maxValue: 22050, automationRate: 'a-rate' as const },
      { name: 'pulseWidth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' as const },
      { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' as const },
      { name: 'drift', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' as const },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    // Only the scheduled stop applies here: an oscillator is never silent while
    // it is running, so there is nothing for a silence backstop to notice. Its
    // amplitude envelope lives downstream, in the voice's gain stage.
    if (this.retire.expired(currentTime)) return false;

    const out = outputs[0]?.[0];
    if (!out) return true;

    const freq = params.frequency;
    const pw = params.pulseWidth;
    const shape = SHAPES[Math.round(params.shape[0])] ?? 'sawtooth';
    const drift = params.drift[0];

    const syncIn = inputs[0]?.[0];

    for (let i = 0; i < out.length; i++) {
      if (syncIn) this.osc.processSync(syncIn[i]);
      out[i] = this.osc.process(
        freq.length > 1 ? freq[i] : freq[0],
        shape,
        pw.length > 1 ? pw[i] : pw[0],
        drift,
      );
    }

    // Mirror to any additional output channels.
    const channels = outputs[0];
    for (let ch = 1; ch < channels.length; ch++) channels[ch].set(out);

    return true;
  }
}

registerProcessor('cw-analog-osc', AnalogOscProcessor);
