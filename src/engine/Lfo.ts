import type { LfoParams } from './Types';
import { logger } from '../debug/Logger';

const SINE_STEPS = 16; // steps per half-cycle for piecewise-sine approximation

function scheduleShape(
  param: AudioParam,
  shape: string,
  startTime: number,
  N: number,
  T: number,
  upTime: number,
  downTime: number,
) {
  for (let i = 0; i < N; i++) {
    const t0 = startTime + i * T;
    switch (shape) {
      case 'square':
        param.setValueAtTime(+1, t0);
        param.setValueAtTime(-1, t0 + upTime);
        break;

      case 'sawtooth':
        param.setValueAtTime(-1, t0);
        param.linearRampToValueAtTime(+1, t0 + upTime);
        param.setValueAtTime(-1, t0 + T - 1e-6); // hard reset at end of cycle
        break;

      case 'triangle':
        param.setValueAtTime(-1, t0);
        param.linearRampToValueAtTime(+1, t0 + upTime);
        param.linearRampToValueAtTime(-1, t0 + T);
        break;

      default: // sine — piecewise linear per half-cycle
        param.setValueAtTime(0, t0);
        for (let s = 1; s <= SINE_STEPS; s++) {
          param.linearRampToValueAtTime(
            Math.sin((s / SINE_STEPS) * Math.PI),
            t0 + (s / SINE_STEPS) * upTime,
          );
        }
        for (let s = 1; s <= SINE_STEPS; s++) {
          param.linearRampToValueAtTime(
            Math.sin(Math.PI + (s / SINE_STEPS) * Math.PI),
            t0 + upTime + (s / SINE_STEPS) * downTime,
          );
        }
        break;
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
  while (t < startTime + totalSec) {
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
    const upTime   = (0.5 + swing * 0.1667) * T;
    const downTime = T - upTime;
    const totalSec = 120;

    if (shape === 'sine' && swing === 0) {
      // Perfect sine when no swing needed — keep OscillatorNode
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = rate;
      osc.connect(this.onsetGain);
      osc.start(startTime);
      this.oscNode = osc;
    } else if (shape === 'random') {
      const cs = this.ctx.createConstantSource();
      scheduleRandom(cs.offset, startTime, totalSec, upTime, downTime);
      cs.connect(this.onsetGain);
      cs.start(startTime);
      this.oscNode = cs;
    } else {
      const cs = this.ctx.createConstantSource();
      const N = Math.ceil(rate * totalSec) + 2;
      scheduleShape(cs.offset, shape, startTime, N, T, upTime, downTime);
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

  stop() {
    if (this.oscNode) {
      logger.log('lfo stop');
      try { this.oscNode.stop(); } catch {}
      try { this.oscNode.disconnect(); } catch {}
      this.oscNode = null;
    }
    this.connections.forEach(g => { try { g.disconnect(); } catch {} });
    this.connections = [];
  }

  dispose() {
    this.stop();
    try { this.onsetGain.disconnect(); } catch {}
  }
}
