import { logger } from '../debug/Logger';

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

  private heldNotes   = new Set<number>();
  private latchNotes  = new Set<number>();
  private latchTimes  = new Map<number, number>(); // semitone → Date.now() when latched ON
  private seq: number[] = [];
  private step    = 0;
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
      if (this.latchNotes.has(semitone)) {
        // Debounce: ignore de-latch if note was just latched ON within 150ms
        // (suppresses ghost mousedown/touchstart fired by Android after touchend)
        const age = Date.now() - (this.latchTimes.get(semitone) ?? 0);
        if (age < 150) {
          logger.log(`arp latch: ignoring ghost de-latch for semi=${semitone} (age=${age}ms)`);
          return;
        }
        this.latchNotes.delete(semitone);
        this.latchTimes.delete(semitone);
        logger.log(`arp latch: removed semi=${semitone}, latch=[${[...this.latchNotes]}]`);
      } else {
        this.latchNotes.add(semitone);
        this.latchTimes.set(semitone, Date.now());
        logger.log(`arp latch: added semi=${semitone}, latch=[${[...this.latchNotes]}]`);
      }
      this._buildSeq([...this.latchNotes]);
    } else {
      this.heldNotes.add(semitone);
      logger.log(`arp hold: addNote semi=${semitone}, held=[${[...this.heldNotes]}]`);
      this._buildSeq([...this.heldNotes]);
    }

    logger.log(`arp seq=[${this.seq}] running=${this.running}`);

    if (!this.seq.length) {
      // No notes — stop the ticker so nextTime doesn't lag behind
      if (this.running) this._stop();
    } else if (!this.running) {
      this._start();
    } else {
      // Already running: reset nextTime to avoid a burst of catch-up ticks
      // that would fire if nextTime drifted behind real time while seq was empty
      this.nextTime = this.getTime() + 0.05;
      logger.log(`arp timing reset: nextTime=${this.nextTime.toFixed(3)}`);
    }
  }

  removeNote(semitone: number) {
    if (this.holdMode === 'hold') {
      this.heldNotes.delete(semitone);
      logger.log(`arp hold: removeNote semi=${semitone}, held=[${[...this.heldNotes]}]`);
      this._buildSeq([...this.heldNotes]);
      if (!this.seq.length) {
        logger.log('arp hold: no notes left, stopping');
        this._stop();
      }
    }
  }

  stop() {
    logger.log('arp stop() called');
    this._stop();
    this.heldNotes.clear();
    this.latchNotes.clear();
    this.latchTimes.clear();
    this.seq = [];
  }

  setPattern(p: ArpPattern) {
    logger.log(`arp setPattern=${p}`);
    this.pattern = p;
    this._buildSeq([...(this.holdMode === 'latch' ? this.latchNotes : this.heldNotes)]);
  }
  setHoldMode(m: HoldMode) {
    logger.log(`arp setHoldMode=${m}`);
    this.holdMode = m;
    this.stop();
  }
  setRate(r: number)    { this.rate = r; }
  setGate(g: number)    { this.gate = g; }
  setOctaves(o: number) {
    this.octaves = o;
    this._buildSeq([...(this.holdMode === 'latch' ? this.latchNotes : this.heldNotes)]);
  }

  private _buildSeq(notes: number[]) {
    if (!notes.length) { this.seq = []; return; }
    const base = [...notes].sort((a, b) => a - b);
    const expanded: number[] = [];
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
    logger.log(`arp _buildSeq: pattern=${this.pattern} seq=[${this.seq}]`);
  }

  private _start() {
    logger.info(`arp _start: rate=${this.rate} gate=${this.gate} octaves=${this.octaves} seq=[${this.seq}] time=${this.getTime().toFixed(3)}`);
    this.running = true;
    this.step = 0;
    this.nextTime = this.getTime() + 0.05;
    this._tick();
  }

  private _stop() {
    logger.log(`arp _stop: was running=${this.running}`);
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

      const onAt    = this.nextTime;
      const offAt   = this.nextTime + stepDur * this.gate;
      const delay    = Math.max(0, (onAt  - now) * 1000);
      const offDelay = Math.max(0, (offAt - now) * 1000);

      logger.log(`arp tick: step=${this.step} semi=${semi} delay=${delay.toFixed(0)}ms`);

      setTimeout(() => { if (this.running) this.noteOn(semi); }, delay);
      setTimeout(() => { this.noteOff(semi); }, offDelay); // always fire to avoid stuck notes

      this.step = (this.step + 1) % seq.length;
      this.nextTime += stepDur;
    }

    this.tickID = setTimeout(() => this._tick(), TICK_MS);
  }
}
