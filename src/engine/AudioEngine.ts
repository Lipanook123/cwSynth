import { Voice } from './Voice';
import { FxChain } from '../fx/FxChain';
import { type PatchParams, DEFAULT_PATCH } from './Types';
import { Arpeggiator } from './Arpeggiator';
import { logger } from '../debug/Logger';

const BASE_HZ = 440; // A4
const BASE_SEMITONE = 69;

export type ScopeSource = 'master' | 'pre-fx' | 'op1' | 'op2' | 'op3' | 'op4' | 'op5' | 'op6';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private analyser!: AnalyserNode;
  private preFxAnalyser!: AnalyserNode;
  private opSumGains: GainNode[] = [];
  private opAnalysers: AnalyserNode[] = [];
  private fx!: FxChain;
  private voices = new Map<number, Voice>(); // semitone → voice
  public arp: Arpeggiator;
  private patch: PatchParams = { ...DEFAULT_PATCH };
  private onStateChange?: () => void;
  private noteListeners = new Set<() => void>();
  private _scopeSource: ScopeSource = 'master';

  constructor() {
    // Arp is created immediately so UI can configure it before the first gesture
    this.arp = new Arpeggiator(
      (semi) => this._noteOn(semi, 0.8),
      (semi) => this._noteOff(semi),
      () => this.ctx?.currentTime ?? 0,
    );
    logger.info('AudioEngine constructed, arp ready');
  }

  // Lazy init — AudioContext only created on first user gesture
  private _init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    logger.info(`AudioContext created, state=${this.ctx.state}, sampleRate=${this.ctx.sampleRate}`);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.patch.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.fx = new FxChain(this.ctx, this.patch.fx);
    this.fx.output.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Pre-FX tap: all voices, post-filter, before effects
    this.preFxAnalyser = this.ctx.createAnalyser();
    this.preFxAnalyser.fftSize = 1024;
    this.fx.input.connect(this.preFxAnalyser);

    // Per-operator sum nodes + analysers (6 ops)
    for (let i = 0; i < 6; i++) {
      const sum = this.ctx.createGain();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      sum.connect(analyser);
      this.opSumGains.push(sum);
      this.opAnalysers.push(analyser);
    }
  }

  resume() {
    this._init();
    if (this.ctx?.state === 'suspended') {
      logger.warn('AudioContext suspended — resuming');
      this.ctx.resume().then(() => logger.info('AudioContext resumed'));
    }
  }

  noteOn(semitone: number, velocity = 0.8) {
    this.resume();
    logger.log(`noteOn semi=${semitone} vel=${velocity.toFixed(2)} arp.enabled=${this.arp.enabled} ctx=${this.ctx?.state ?? 'null'}`);
    if (this.arp.enabled) {
      this.arp.addNote(semitone);
    } else {
      this._noteOn(semitone, velocity);
    }
  }

  noteOff(semitone: number) {
    logger.log(`noteOff semi=${semitone} arp.enabled=${this.arp.enabled}`);
    if (this.arp.enabled) {
      this.arp.removeNote(semitone);
    } else {
      this._noteOff(semitone);
    }
  }

  _noteOn(semitone: number, velocity: number) {
    if (!this.ctx) { logger.error('_noteOn: no AudioContext'); return; }
    if (this.voices.has(semitone)) {
      const old = this.voices.get(semitone)!;
      old.disconnectOperatorOutputsFrom(this.opSumGains);
      old.noteOff(this.ctx.currentTime);
      setTimeout(() => old.dispose(), 2000);
    }

    const hz = BASE_HZ * Math.pow(2, (semitone + this.patch.transpose - BASE_SEMITONE) / 12);
    logger.log(`_noteOn semi=${semitone} hz=${hz.toFixed(1)}`);
    const voice = new Voice(this.ctx, this.patch, semitone, hz);
    voice.output.connect(this.fx.input);
    voice.connectOperatorOutputsTo(this.opSumGains);
    voice.noteOn(velocity, this.ctx.currentTime);
    this.voices.set(semitone, voice);
    this.noteListeners.forEach(fn => fn());
    this.onStateChange?.();
  }

  _noteOff(semitone: number) {
    if (!this.ctx) return;
    const voice = this.voices.get(semitone);
    if (!voice) { logger.warn(`_noteOff: no voice for semi=${semitone}`); return; }
    logger.log(`_noteOff semi=${semitone}`);
    voice.noteOff(this.ctx.currentTime);
    voice.recordNoteOff(this.ctx.currentTime);
    this.voices.delete(semitone);
    this.noteListeners.forEach(fn => fn());
    const maxRel = Math.max(...this.patch.operators.map(o => o.release)) + 0.5;
    setTimeout(() => {
      voice.disconnectOperatorOutputsFrom(this.opSumGains);
      voice.dispose();
    }, maxRel * 1000);
    this.onStateChange?.();
  }

  allNotesOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach(v => {
      v.disconnectOperatorOutputsFrom(this.opSumGains);
      v.noteOff(t);
      setTimeout(() => v.dispose(), 2000);
    });
    this.voices.clear();
  }

  loadPatch(patch: PatchParams) {
    logger.info(`loadPatch: ${patch.name}`);
    this.allNotesOff();
    this.patch = { ...patch };
    this._init();
    this.masterGain.gain.value = patch.volume;
    this.fx.update(patch.fx);
    this.onStateChange?.();
  }

  updatePatch(partial: Partial<PatchParams>) {
    this.patch = { ...this.patch, ...partial };
    this._init();
    this.masterGain.gain.value = this.patch.volume;
    this.fx.update(this.patch.fx);
    this.onStateChange?.();
  }

  getPatch(): PatchParams { return this.patch; }

  getActiveNotes(): ReadonlySet<number> { return new Set(this.voices.keys()); }

  getAnalyser(): AnalyserNode | null { return this.analyser ?? null; }

  getScopeSource(): ScopeSource { return this._scopeSource; }
  setScopeSource(s: ScopeSource) { this._scopeSource = s; }

  getAnalyserFor(source: ScopeSource): AnalyserNode | null {
    if (!this.ctx) return null;
    if (source === 'master') return this.analyser ?? null;
    if (source === 'pre-fx') return this.preFxAnalyser ?? null;
    const idx = parseInt(source.slice(2)) - 1; // 'op1' → 0
    return this.opAnalysers[idx] ?? null;
  }

  setAllFftSizes(size: number): void {
    if (this.analyser) this.analyser.fftSize = size;
    if (this.preFxAnalyser) this.preFxAnalyser.fftSize = size;
    this.opAnalysers.forEach(a => { a.fftSize = size; });
  }

  setOnStateChange(cb: () => void) { this.onStateChange = cb; }

  /** Subscribe to voice add/remove. Returns an unsubscribe function. */
  addNoteListener(cb: () => void): () => void {
    this.noteListeners.add(cb);
    return () => this.noteListeners.delete(cb);
  }

  dispose() {
    this.allNotesOff();
    this.arp?.stop();
    this.fx?.dispose();
    this.ctx?.close();
    this.ctx = null;
  }
}

export const engine = new AudioEngine();
