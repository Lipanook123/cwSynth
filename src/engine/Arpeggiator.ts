type NoteFn = (semitone: number) => void;
type TimeFn = () => number;

type ArpPattern = 'up' | 'down' | 'updown' | 'random';
type HoldMode   = 'hold' | 'latch';

const LOOKAHEAD = 0.08;  // seconds
const TICK_MS   = 25;    // ms

export class Arpeggiator {
  public enabled = false;
  public pattern: ArpPattern = 'up';
  public holdMode: HoldMode  = 'latch';
  public rate    = 8;      // steps/sec
  public gate    = 0.6;    // fraction of step
  public octaves = 1;

  private heldNotes  = new Set<number>();
  private latchNotes = new Set<number>();
  private seq: number[] = [];
  private step   = 0;
  private running = false;
  private nextTime = 0;
  private tickID: ReturnType<typeof setTimeout> | null = null;

  private noteOn:  NoteFn;
  private noteOff: NoteFn;
  private getTime: TimeFn;

  constructor(noteOn: NoteFn, noteOff: NoteFn, getTime: TimeFn) {
    this.noteOn  = noteOn;
    this.noteOff = noteOff;
    this.getTime = getTime;
  }

  addNote(semitone: number) {
    if (this.holdMode === 'latch') {
      if (this.latchNotes.has(semitone)) { this.latchNotes.delete(semitone); }
      else { this.latchNotes.add(semitone); }
      this._buildSeq([...this.latchNotes]);
    } else {
      this.heldNotes.add(semitone);
      this._buildSeq([...this.heldNotes]);
    }
    if (this.seq.length && !this.running) this._start();
  }

  removeNote(semitone: number) {
    if (this.holdMode === 'hold') {
      this.heldNotes.delete(semitone);
      this._buildSeq([...this.heldNotes]);
      if (!this.seq.length) this._stop();
    }
  }

  stop() {
    this._stop();
    this.heldNotes.clear();
    this.latchNotes.clear();
    this.seq = [];
  }

  setPattern(p: ArpPattern) { this.pattern = p; this._buildSeq([...(this.holdMode === 'latch' ? this.latchNotes : this.heldNotes)]); }
  setHoldMode(m: HoldMode) { this.holdMode = m; this.stop(); }
  setRate(r: number) { this.rate = r; }
  setGate(g: number) { this.gate = g; }
  setOctaves(o: number) { this.octaves = o; this._buildSeq([...(this.holdMode === 'latch' ? this.latchNotes : this.heldNotes)]); }

  private _buildSeq(notes: number[]) {
    if (!notes.length) { this.seq = []; return; }
    const base = [...notes].sort((a, b) => a - b);
    let expanded: number[] = [];
    for (let o = 0; o < this.octaves; o++) base.forEach(n => expanded.push(n + o * 12));

    switch (this.pattern) {
      case 'up':     this.seq = expanded; break;
      case 'down':   this.seq = [...expanded].reverse(); break;
      case 'updown': this.seq = expanded.length > 1
        ? [...expanded, ...[...expanded].reverse().slice(1, -1)]
        : expanded; break;
      case 'random': this.seq = expanded; break;
    }
    if (this.step >= this.seq.length) this.step = 0;
  }

  private _start() {
    this.running = true;
    this.step = 0;
    this.nextTime = this.getTime() + 0.05;
    this._tick();
  }

  private _stop() {
    this.running = false;
    if (this.tickID) { clearTimeout(this.tickID); this.tickID = null; }
  }

  private _tick() {
    if (!this.running) return;
    const now = this.getTime();
    const stepDur = 1 / this.rate;

    while (this.nextTime < now + LOOKAHEAD) {
      if (!this.seq.length) break;
      const seq = this.pattern === 'random'
        ? [...this.seq].sort(() => Math.random() - 0.5)
        : this.seq;
      const semi = seq[this.step % seq.length];

      // Schedule via callbacks (engine handles actual audio timing)
      const onAt  = this.nextTime;
      const offAt = this.nextTime + stepDur * this.gate;
      const delay = Math.max(0, (onAt - now) * 1000);
      const offDelay = Math.max(0, (offAt - now) * 1000);

      setTimeout(() => { if (this.running) this.noteOn(semi); }, delay);
      setTimeout(() => { if (this.running) this.noteOff(semi); }, offDelay);

      this.step = (this.step + 1) % seq.length;
      this.nextTime += stepDur;
    }

    this.tickID = setTimeout(() => this._tick(), TICK_MS);
  }
}
