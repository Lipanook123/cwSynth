import { Voice } from './Voice';
import { FxChain } from '../fx/FxChain';
import { PatchParams, DEFAULT_PATCH } from './Types';
import { Arpeggiator } from './Arpeggiator';

const BASE_HZ = 440; // A4
const BASE_SEMITONE = 69;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private analyser!: AnalyserNode;
  private fx!: FxChain;
  private voices = new Map<number, Voice>(); // semitone → voice
  public arp!: Arpeggiator;
  private patch: PatchParams = { ...DEFAULT_PATCH };
  private onStateChange?: () => void;

  // Lazy init — AudioContext only created on first user gesture
  private _init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.patch.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.fx = new FxChain(this.ctx, this.patch.fx);
    this.fx.output.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.arp = new Arpeggiator(
      (semi) => this._noteOn(semi, 0.8),
      (semi) => this._noteOff(semi),
      () => this.ctx!.currentTime
    );
  }

  resume() {
    this._init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  noteOn(semitone: number, velocity = 0.8) {
    this.resume();
    if (this.arp?.enabled) {
      this.arp.addNote(semitone);
    } else {
      this._noteOn(semitone, velocity);
    }
  }

  noteOff(semitone: number) {
    if (this.arp?.enabled) {
      this.arp.removeNote(semitone);
    } else {
      this._noteOff(semitone);
    }
  }

  _noteOn(semitone: number, velocity: number) {
    if (!this.ctx) return;
    // Kill existing voice on same semitone
    if (this.voices.has(semitone)) {
      const old = this.voices.get(semitone)!;
      old.noteOff(this.ctx.currentTime);
      setTimeout(() => old.dispose(), 2000);
    }

    const hz = BASE_HZ * Math.pow(2, (semitone + this.patch.transpose - BASE_SEMITONE) / 12);
    const voice = new Voice(this.ctx, this.patch, semitone, hz);
    voice.output.connect(this.fx.input);
    voice.noteOn(velocity, this.ctx.currentTime);
    this.voices.set(semitone, voice);
    this.onStateChange?.();
  }

  _noteOff(semitone: number) {
    if (!this.ctx) return;
    const voice = this.voices.get(semitone);
    if (!voice) return;
    voice.noteOff(this.ctx.currentTime);
    voice.recordNoteOff(this.ctx.currentTime);
    this.voices.delete(semitone);
    const maxRel = Math.max(...this.patch.operators.map(o => o.release)) + 0.5;
    setTimeout(() => voice.dispose(), maxRel * 1000);
    this.onStateChange?.();
  }

  allNotesOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach(v => { v.noteOff(t); setTimeout(() => v.dispose(), 2000); });
    this.voices.clear();
  }

  loadPatch(patch: PatchParams) {
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

  getAnalyser(): AnalyserNode | null { return this.analyser ?? null; }

  setOnStateChange(cb: () => void) { this.onStateChange = cb; }

  dispose() {
    this.allNotesOff();
    this.arp?.stop();
    this.fx?.dispose();
    this.ctx?.close();
    this.ctx = null;
  }
}

export const engine = new AudioEngine();
