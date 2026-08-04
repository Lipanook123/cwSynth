// Minimal Web Audio stand-in, enough to drive the whole engine headlessly.
// Records the node graph so tests can assert what is connected to what.

export interface Conn { target: unknown }

export class FakeParam {
  value: number;
  readonly incoming: FakeGain[] = [];
  constructor(value = 0, public name = '') { this.value = value; }
  cancelScheduledValues() { return this; }
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  setValueCurveAtTime() { return this; }
}

export class FakeNode {
  readonly connections: Conn[] = [];
  connect(target: unknown) {
    this.connections.push({ target });
    if (target instanceof FakeParam && this instanceof FakeGain) target.incoming.push(this);
    return target as never;
  }
  disconnect() {}
}

export class FakeGain extends FakeNode { gain = new FakeParam(1, 'gain'); }
export class FakeOsc extends FakeNode {
  frequency = new FakeParam(440, 'frequency');
  detune = new FakeParam(0, 'detune');
  type = 'sine';
  start() {} stop() {} setPeriodicWave() {}
}
export class FakeDelay extends FakeNode { delayTime = new FakeParam(0, 'delayTime'); }
export class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350, 'frequency');
  Q = new FakeParam(1, 'Q');
  gain = new FakeParam(0, 'gain');
}
export class FakeConstant extends FakeNode { offset = new FakeParam(1, 'offset'); start() {} stop() {} }
export class FakeBufferSource extends FakeNode { buffer: unknown = null; start() {} stop() {} }
export class FakeConvolver extends FakeNode { buffer: unknown = null; }
export class FakeStereoPanner extends FakeNode { pan = new FakeParam(0, 'pan'); }
export class FakeWaveShaper extends FakeNode { curve: unknown = null; oversample = 'none'; }
/**
 * Stand-in for AudioWorkletNode. `parameters` is a Map of FakeParams, mirroring
 * the real API — which is what lets the engine treat a worklet's cutoff exactly
 * like a BiquadFilterNode's frequency.
 */
export class FakeAudioWorkletNode extends FakeNode {
  readonly parameters: Map<string, FakeParam>;
  readonly port = {
    postMessage: () => {},
    onmessage: null as ((e: MessageEvent) => void) | null,
    close: () => {},
  };
  constructor(_ctx: unknown, public processorName: string) {
    super();
    // Superset of the params both processors declare; unknown reads are
    // harmless and a missing one would throw exactly as it would in a browser.
    this.parameters = new Map([
      ['cutoff', new FakeParam(2000, 'cutoff')],
      ['resonance', new FakeParam(0, 'resonance')],
      ['drive', new FakeParam(0, 'drive')],
      ['model', new FakeParam(0, 'model')],
      ['mode', new FakeParam(0, 'mode')],
      ['slope', new FakeParam(24, 'slope')],
      ['frequency', new FakeParam(440, 'frequency')],
      ['pulseWidth', new FakeParam(0.5, 'pulseWidth')],
      ['shape', new FakeParam(0, 'shape')],
      ['drift', new FakeParam(0, 'drift')],
    ]);
  }
}

export class FakeAnalyser extends FakeNode {
  fftSize = 1024;
  frequencyBinCount = 512;
  getByteTimeDomainData() {}
  getFloatTimeDomainData() {}
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'running';
  destination = new FakeNode();

  /** Set false to simulate a browser without AudioWorklet, exercising fallbacks. */
  static workletSupport = true;

  audioWorklet = FakeAudioContext.workletSupport
    ? { addModule: () => Promise.resolve() }
    : undefined;

  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOsc(); }
  createDelay() { return new FakeDelay(); }
  createBiquadFilter() { return new FakeBiquad(); }
  createConstantSource() { return new FakeConstant(); }
  createBufferSource() { return new FakeBufferSource(); }
  createConvolver() { return new FakeConvolver(); }
  createStereoPanner() { return new FakeStereoPanner(); }
  createWaveShaper() { return new FakeWaveShaper(); }
  createAnalyser() { return new FakeAnalyser(); }
  createPeriodicWave() { return {}; }
  createBuffer(channels: number, len: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(len));
    return { length: len, numberOfChannels: channels, getChannelData: (i: number) => data[i] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

/**
 * Install the fake as the global AudioContext and AudioWorkletNode.
 * Returns a restore function.
 */
export function installFakeAudio(opts: { worklets?: boolean } = {}): () => void {
  const g = globalThis as Record<string, unknown>;
  const prevCtx = g.AudioContext;
  const prevNode = g.AudioWorkletNode;
  FakeAudioContext.workletSupport = opts.worklets !== false;
  g.AudioContext = FakeAudioContext;
  g.AudioWorkletNode = FakeAudioWorkletNode;
  return () => {
    g.AudioContext = prevCtx;
    g.AudioWorkletNode = prevNode;
  };
}

export const makeCtx = () => new FakeAudioContext() as unknown as AudioContext;
