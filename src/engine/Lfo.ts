import type { LfoParams } from './Types';
import { logger } from '../debug/Logger';

/**
 * Longest span of LFO motion scheduled ahead for the shapes that have to be
 * drawn with automation events. A note outliving this stops moving, which is
 * why it is generous — but it is bounded, and that is the point.
 */
const SCHEDULE_SEC = 120;

/**
 * Hard ceiling on automation events per LFO start.
 *
 * Without it the event count scales with rate: a 5 Hz LFO over 120 s once cost
 * ~20,000 AudioParam calls per note, which is 21 ms of blocking main-thread work
 * every time a key goes down. Under an arpeggiator that is a 21 ms freeze eight
 * times a second — the engine falls behind its own note scheduling and notes
 * start dropping out one by one. Every other patch costs 1-3 ms per note; this
 * keeps the automation-drawn shapes in that range too.
 */
const MAX_EVENTS = 1000;

/** Samples per cycle in the wavetable used for the oscillator-driven shapes. */
const TABLE = 512;
/**
 * Harmonics kept when converting that table to a PeriodicWave.
 *
 * Both shapes on this path are continuous and their harmonics fall away fast
 * (a triangle's as 1/k²), so 64 is already past the point of visible difference
 * — and the DFT is O(TABLE × HARMONICS), paid on the first note of a patch.
 */
const HARMONICS = 64;

/** Fraction of the cycle spent on the rising half, given `swing`. */
function upFraction(swing: number): number {
  return 0.5 + swing * 0.1667;
}

/**
 * Shapes that can be drawn by an OscillatorNode instead of by automation.
 *
 * Both are continuous, so a band-limited PeriodicWave reproduces them without
 * the ringing a square or sawtooth would pick up at its discontinuities. Those
 * two keep the automation path, where their edges stay exact and they only cost
 * 2-3 events per cycle anyway.
 */
const WAVE_SHAPES = new Set(['sine', 'triangle']);

/** One cycle of `shape` at phase `p` (0..1), matching `scheduleShape` exactly. */
function shapeSample(shape: string, p: number, up: number): number {
  if (shape === 'triangle') {
    return p < up
      ? -1 + 2 * (p / up)
      : 1 - 2 * ((p - up) / (1 - up));
  }
  // sine — a positive lobe over the rising fraction, a negative one over the rest
  return p < up
    ? Math.sin(Math.PI * (p / up))
    : Math.sin(Math.PI + Math.PI * ((p - up) / (1 - up)));
}

const COS = new Float32Array(TABLE);
const SIN = new Float32Array(TABLE);
for (let i = 0; i < TABLE; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / TABLE);
  SIN[i] = Math.sin((2 * Math.PI * i) / TABLE);
}

// PeriodicWave is bound to the context that created it, and building one costs a
// DFT, so cache per context and per (shape, swing).
const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

function periodicWaveFor(ctx: AudioContext, shape: string, swing: number): PeriodicWave {
  let byShape = waveCache.get(ctx);
  if (!byShape) { byShape = new Map(); waveCache.set(ctx, byShape); }
  const key = `${shape}:${swing.toFixed(3)}`;
  const cached = byShape.get(key);
  if (cached) return cached;

  const up = upFraction(swing);
  const data = new Float32Array(TABLE);
  for (let n = 0; n < TABLE; n++) data[n] = shapeSample(shape, n / TABLE, up);

  // Forward DFT into the real/imag form createPeriodicWave expects. Bin 0 is
  // ignored by the spec, so any DC offset a swung shape carries is dropped —
  // which is what an LFO wants anyway.
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < TABLE; n++) {
      // (k·n mod TABLE) indexes the shared cosine table, so the inner loop is
      // two array reads rather than two trig calls.
      const idx = (k * n) % TABLE;
      re += data[n] * COS[idx];
      im -= data[n] * SIN[idx];
    }
    real[k] = re / TABLE;
    imag[k] = im / TABLE;
  }

  // Normalisation rescales the result to peak 1, which is exactly the ±1 range
  // the mod matrix scales against.
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  byShape.set(key, wave);
  return wave;
}

function scheduleShape(
  param: AudioParam,
  shape: string,
  startTime: number,
  N: number,
  T: number,
  upTime: number,
) {
  for (let i = 0; i < N; i++) {
    const t0 = startTime + i * T;
    if (shape === 'square') {
      param.setValueAtTime(+1, t0);
      param.setValueAtTime(-1, t0 + upTime);
    } else {
      param.setValueAtTime(-1, t0);
      param.linearRampToValueAtTime(+1, t0 + upTime);
      param.setValueAtTime(-1, t0 + T - 1e-6); // hard reset at end of cycle
    }
  }
}

// Random uses accumulated time because alternating durations shift each step's start
function scheduleRandom(
  param: AudioParam,
  startTime: number,
  totalSec: number,
  upTime: number,
  downTime: number,
) {
  let t = startTime;
  let step = 0;
  const end = startTime + totalSec;
  while (t < end && step < MAX_EVENTS) {
    param.setValueAtTime(Math.random() * 2 - 1, t);
    t += step % 2 === 0 ? upTime : downTime;
    step++;
  }
}

export class Lfo {
  private ctx: AudioContext;
  private oscNode: AudioScheduledSourceNode | null = null;
  private onsetGain: GainNode;
  private connections: GainNode[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.onsetGain = ctx.createGain();
    this.onsetGain.gain.value = 0;
  }

  start(params: LfoParams, startTime: number) {
    this.stop();
    const { shape, rate, depth, delay, swing } = params;
    logger.log(`lfo start shape=${shape} rate=${rate.toFixed(2)} depth=${depth.toFixed(2)} delay=${delay.toFixed(2)} swing=${swing.toFixed(2)} t=${startTime.toFixed(3)}`);

    const T        = 1 / rate;
    const upTime   = upFraction(swing) * T;
    const downTime = T - upTime;

    if (WAVE_SHAPES.has(shape)) {
      // An oscillator costs no automation events at all, whatever the rate —
      // which is the whole reason these two shapes do not go through
      // scheduleShape any more.
      const osc = this.ctx.createOscillator();
      if (shape === 'sine' && swing === 0) {
        osc.type = 'sine';
      } else {
        osc.setPeriodicWave(periodicWaveFor(this.ctx, shape, swing));
      }
      osc.frequency.value = rate;
      osc.connect(this.onsetGain);
      osc.start(startTime);
      this.oscNode = osc;
    } else if (shape === 'random') {
      const cs = this.ctx.createConstantSource();
      scheduleRandom(cs.offset, startTime, SCHEDULE_SEC, upTime, downTime);
      cs.connect(this.onsetGain);
      cs.start(startTime);
      this.oscNode = cs;
    } else {
      // square and sawtooth: 2 and 3 events per cycle, capped so a fast LFO
      // cannot turn a note-on into a long blocking scheduling loop.
      const eventsPerCycle = shape === 'square' ? 2 : 3;
      const N = Math.min(
        Math.ceil(rate * SCHEDULE_SEC) + 2,
        Math.floor(MAX_EVENTS / eventsPerCycle),
      );
      const cs = this.ctx.createConstantSource();
      scheduleShape(cs.offset, shape, startTime, N, T, upTime);
      cs.connect(this.onsetGain);
      cs.start(startTime);
      this.oscNode = cs;
    }

    // Delay onset ramp
    const g = this.onsetGain.gain;
    g.cancelScheduledValues(startTime);
    g.setValueAtTime(0, startTime);
    if (delay > 0) {
      g.linearRampToValueAtTime(1, startTime + delay);
    } else {
      g.setValueAtTime(1, startTime);
    }

    void depth; // depth is applied by Voice via addConnection scaleAmount
  }

  addConnection(target: AudioParam, scaleAmount: number) {
    logger.log(`lfo addConnection scale=${scaleAmount.toFixed(4)}`);
    const g = this.ctx.createGain();
    g.gain.value = scaleAmount;
    this.onsetGain.connect(g);
    g.connect(target);
    this.connections.push(g);
  }

  /**
   * Stop the LFO, optionally at a scheduled time.
   *
   * Without a time this halts immediately, which cuts vibrato dead the instant
   * a key is released rather than letting it ride the release tail. It also
   * breaks any caller that schedules a note-off ahead of time — offline
   * rendering in particular, where the whole note would come out unmodulated.
   */
  stop(time?: number) {
    const node = this.oscNode;
    const conns = this.connections;
    this.oscNode = null;
    this.connections = [];

    if (!node) {
      conns.forEach(g => { try { g.disconnect(); } catch {} });
      return;
    }

    const now = this.ctx.currentTime;
    const at = time !== undefined && time > now ? time : now;
    logger.log(`lfo stop at ${at.toFixed(3)}`);
    try { node.stop(at); } catch {}

    // Tear down only once the LFO has actually finished, or the disconnect
    // would silence it early regardless of the scheduled stop.
    const delayMs = (at - now) * 1000 + 50;
    setTimeout(() => {
      try { node.disconnect(); } catch {}
      conns.forEach(g => { try { g.disconnect(); } catch {} });
    }, Math.max(0, delayMs));
  }

  dispose() {
    this.stop();
    try { this.onsetGain.disconnect(); } catch {}
  }
}
