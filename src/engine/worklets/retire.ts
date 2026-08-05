// Retirement policy shared by the worklet processors.
//
// An AudioWorkletProcessor whose process() keeps returning true is never
// collected, even once its node is disconnected — it runs for the life of the
// AudioContext. With one filter and three oscillators per voice, a processor
// that outlives its note is a processor leaked per note, and arpeggiated
// playing starves the audio thread within a minute. Every processor here must
// therefore retire itself, and this is the one place that decides when.
//
// Two mechanisms, because neither is sufficient alone:
//
//   • A *scheduled* stop. The engine knows when a voice ends, so it says so —
//     as an AudioContext timestamp, not as "now". A setTimeout-driven stop is
//     posted late exactly when the main thread is busy, which is precisely the
//     moment the audio thread can least afford to keep rendering a dead voice.
//     Comparing against the audio clock makes retirement independent of it.
//
//   • *Silence.* A processor producing nothing, fed nothing, has no reason to
//     exist regardless of what anyone scheduled. This is the backstop that
//     bounds the damage from any missed or late stop message.

/** Below this a block counts as silence: -100 dBFS, inaudible under anything. */
const SILENCE = 1e-5;

/**
 * How long silence must last before retiring, once the engine has said when the
 * voice ends. This is the common case and it is the whole win: a release tail
 * goes quiet long before the voice's teardown timer comes round.
 */
const SILENCE_TIMEOUT = 0.15;

/**
 * How long silence must last when no deadline has been scheduled at all.
 *
 * Far longer, because with no stated end this is guessing. An envelope stage
 * pinned to exactly zero for two seconds in the middle of a held note would be
 * cut short — no musical patch does that, and the alternative is having no
 * backstop against a node whose stop message never arrives.
 */
const ORPHAN_TIMEOUT = 2;

export class Retirement {
  /** AudioContext time to retire at, or null while none has been scheduled. */
  private stopAt: number | null = null;
  private quietQuanta = 0;
  private quietLimit: number;
  private orphanLimit: number;
  /**
   * Whether this processor has ever produced sound. Silence before the first
   * note-on is not a reason to retire — a voice with a slow attack is silent
   * for its first samples, and retiring there would kill it before it started.
   */
  private sounded = false;

  constructor(sampleRateHz: number, quantum = 128) {
    this.quietLimit = Math.ceil((SILENCE_TIMEOUT * sampleRateHz) / quantum);
    this.orphanLimit = Math.ceil((ORPHAN_TIMEOUT * sampleRateHz) / quantum);
  }

  /**
   * Handle a message from the node. `{type:'stop'}` retires at the next block;
   * `{type:'stop', at}` retires once the audio clock reaches `at`.
   */
  onMessage(data: unknown): void {
    const msg = data as { type?: string; at?: number } | null;
    if (msg?.type !== 'stop') return;
    this.stopAt = typeof msg.at === 'number' ? msg.at : 0;
  }

  /** True when the processor should return false from process() now. */
  expired(now: number): boolean {
    return this.stopAt !== null && now >= this.stopAt;
  }

  /**
   * Report what a block produced. Returns true once the processor has been
   * silent long enough to retire.
   */
  observe(block: Float32Array): boolean {
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const v = block[i] < 0 ? -block[i] : block[i];
      if (v > peak) peak = v;
    }
    if (peak > SILENCE) {
      this.sounded = true;
      this.quietQuanta = 0;
      return false;
    }
    if (!this.sounded) return false;
    const limit = this.stopAt === null ? this.orphanLimit : this.quietLimit;
    return ++this.quietQuanta >= limit;
  }
}
