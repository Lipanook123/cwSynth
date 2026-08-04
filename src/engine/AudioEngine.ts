import { Voice } from './Voice';
import { FxChain } from '../fx/FxChain';
import { type PatchParams, DEFAULT_PATCH } from './Types';
import { Arpeggiator } from './Arpeggiator';
import { Lfo } from './Lfo';
import { loadWorklets, workletsReady } from './worklets';
import { logger } from '../debug/Logger';

const BASE_HZ = 440; // A4
const BASE_SEMITONE = 69;

export type ScopeSource = 'master' | 'pre-fx' | 'op1' | 'op2' | 'op3' | 'op4' | 'op5' | 'op6';

export interface ScopeDisplayParams {
  vDiv: number;
  yPos: number;
  coupling: 'AC' | 'DC';
  trigLevel: number;
  trigEdge: 'rise' | 'fall';
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private analyser!: AnalyserNode;
  private preFxAnalyser!: AnalyserNode;
  private opSumGains: GainNode[] = [];
  private opAnalysers: AnalyserNode[] = [];
  private fx!: FxChain;
  private globalLfoA!: Lfo;
  private globalLfoB!: Lfo;
  // Insertion-ordered, so the first entry is always the oldest sounding voice.
  private voices = new Map<number, Voice>(); // semitone → voice
  public arp: Arpeggiator;
  private patch: PatchParams = { ...DEFAULT_PATCH };
  private onStateChange?: () => void;
  private noteListeners = new Set<() => void>();
  private _scopeSource: ScopeSource = 'master';
  private _scopeParams: ScopeDisplayParams = { vDiv: 0.5, yPos: 0, coupling: 'DC', trigLevel: 0, trigEdge: 'rise' };

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
    // Start loading immediately; consumers fall back until this resolves.
    void loadWorklets(this.ctx);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.patch.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.fx = new FxChain(this.ctx, this.patch.fx);
    this.fx.output.connect(this.masterGain);
    this.globalLfoA = new Lfo(this.ctx);
    this.globalLfoB = new Lfo(this.ctx);
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

  /**
   * Create the AudioContext and start loading worklets, without waiting for a
   * user gesture.
   *
   * A new AudioContext begins life *suspended*, which browsers allow — only
   * producing sound needs a gesture. Doing this early matters because
   * `addModule` is async while `noteOn` is not: if the first note arrives before
   * the module lands, it silently uses the fallback nodes and sounds wrong.
   * Call this from a mount effect so the worklets are ready long before anyone
   * touches a key.
   */
  preload(): Promise<boolean> {
    this._init();
    return this.ctx ? loadWorklets(this.ctx) : Promise.resolve(false);
  }

  resume() {
    this._init();
    if (this.ctx?.state === 'suspended') {
      logger.warn('AudioContext suspended — resuming');
      this.ctx.resume().then(() => logger.info('AudioContext resumed'));
    }
  }

  /** True once the worklet processors are registered; false means fallback nodes. */
  hasWorklets(): boolean { return workletsReady(this.ctx); }

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

  /** Retire a voice: fade already scheduled, disconnect taps and free its nodes. */
  private _retire(voice: Voice, afterSeconds: number) {
    setTimeout(() => {
      voice.disconnectOperatorOutputsFrom(this.opSumGains);
      voice.dispose();
    }, Math.max(0, afterSeconds) * 1000);
  }

  /**
   * Drop the oldest sounding voice when the polyphony ceiling is reached.
   * Without this, holding the sustain of a long-release patch grows the graph
   * without bound — and unison multiplies voice count per note.
   */
  private _stealIfNeeded() {
    const limit = Math.max(1, this.patch.polyphony);
    while (this.voices.size >= limit) {
      const oldest = this.voices.keys().next();
      if (oldest.done) break;
      const victim = this.voices.get(oldest.value)!;
      logger.log(`voice steal: semi=${oldest.value} (limit=${limit})`);
      victim.steal(this.ctx!.currentTime);
      this.voices.delete(oldest.value);
      this._retire(victim, 0.1);
    }
  }

  _noteOn(semitone: number, velocity: number) {
    if (!this.ctx) { logger.error('_noteOn: no AudioContext'); return; }
    const existing = this.voices.get(semitone);
    if (existing) {
      existing.steal(this.ctx.currentTime);
      this.voices.delete(semitone);
      this._retire(existing, 0.1);
    }
    this._stealIfNeeded();

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
    this.voices.delete(semitone);
    this.noteListeners.forEach(fn => fn());
    // Release time comes from the voice's own enabled operators, not from every
    // operator in the patch — a disabled op used to keep voices alive.
    this._retire(voice, voice.releaseTime() + 0.5);
    this.onStateChange?.();
  }

  allNotesOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach(v => {
      v.steal(t);
      this._retire(v, 0.1);
    });
    this.voices.clear();
  }

  /**
   * The FX bus is global, so fx_reverb / fx_delay / fx_chorus can't be driven by
   * the per-voice LFOs — with several notes held, each voice's LFO would sum
   * into the same param at multiple times the intended depth and in random
   * phase. These two run free instead, rewired whenever the matrix changes.
   */
  private _rewireGlobalMod() {
    if (!this.ctx) return;
    this.globalLfoA.stop();
    this.globalLfoB.stop();

    const slots = this.patch.modMatrix.filter(s =>
      s.enabled && (s.dest === 'fx_reverb' || s.dest === 'fx_delay' || s.dest === 'fx_chorus'));
    if (!slots.length) return;

    const t = this.ctx.currentTime;
    const needA = slots.some(s => s.source === 'lfo1');
    const needB = slots.some(s => s.source === 'lfo2');
    if (needA) this.globalLfoA.start(this.patch.lfo1, t);
    if (needB) this.globalLfoB.start(this.patch.lfo2, t);

    for (const slot of slots) {
      const lfo = slot.source === 'lfo1' ? this.globalLfoA
                : slot.source === 'lfo2' ? this.globalLfoB : null;
      if (!lfo) continue;
      const depth = slot.source === 'lfo1' ? this.patch.lfo1.depth : this.patch.lfo2.depth;
      const which = slot.dest === 'fx_reverb' ? 'reverb'
                  : slot.dest === 'fx_delay'  ? 'delay' : 'chorus';
      // Wet mix is 0..1, so a unit LFO swings it by at most half the range.
      lfo.addConnection(this.fx.getWetParam(which), slot.amount * depth * 0.5);
    }
  }

  loadPatch(patch: PatchParams) {
    logger.info(`loadPatch: ${patch.name}`);
    this.allNotesOff();
    this.patch = { ...patch };
    this._init();
    this.masterGain.gain.value = patch.volume;
    this.fx.update(patch.fx);
    this._rewireGlobalMod();
    this.onStateChange?.();
  }

  updatePatch(partial: Partial<PatchParams>) {
    this.patch = { ...this.patch, ...partial };
    this._init();
    this.masterGain.gain.value = this.patch.volume;
    this.fx.update(this.patch.fx);
    if (partial.modMatrix || partial.lfo1 || partial.lfo2) this._rewireGlobalMod();
    this.onStateChange?.();
  }

  getPatch(): PatchParams { return this.patch; }

  getActiveNotes(): ReadonlySet<number> { return new Set(this.voices.keys()); }

  getAnalyser(): AnalyserNode | null { return this.analyser ?? null; }

  getScopeSource(): ScopeSource { return this._scopeSource; }
  setScopeSource(s: ScopeSource) { this._scopeSource = s; }

  getScopeParams(): ScopeDisplayParams { return this._scopeParams; }
  setScopeParams(p: ScopeDisplayParams) { this._scopeParams = p; }

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
    this.globalLfoA?.dispose();
    this.globalLfoB?.dispose();
    this.fx?.dispose();
    this.ctx?.close();
    this.ctx = null;
  }
}

export const engine = new AudioEngine();
