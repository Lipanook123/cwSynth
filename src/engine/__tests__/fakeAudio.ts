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
export class FakeWaveShaper extends FakeNode { curve: unknown = null; oversample = 'none'; }
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

  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOsc(); }
  createDelay() { return new FakeDelay(); }
  createBiquadFilter() { return new FakeBiquad(); }
  createConstantSource() { return new FakeConstant(); }
  createBufferSource() { return new FakeBufferSource(); }
  createConvolver() { return new FakeConvolver(); }
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

/** Install the fake as the global AudioContext. Returns a restore function. */
export function installFakeAudio(): () => void {
  const g = globalThis as Record<string, unknown>;
  const prev = g.AudioContext;
  g.AudioContext = FakeAudioContext;
  return () => { g.AudioContext = prev; };
}

export const makeCtx = () => new FakeAudioContext() as unknown as AudioContext;
