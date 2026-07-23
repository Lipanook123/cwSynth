import type { LfoParams } from './Types';
import { logger } from '../debug/Logger';

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
    logger.log(`lfo start shape=${params.shape} rate=${params.rate.toFixed(2)} depth=${params.depth.toFixed(2)} delay=${params.delay.toFixed(2)} t=${startTime.toFixed(3)}`);

    if (params.shape === 'random') {
      const cs = this.ctx.createConstantSource();
      const steps = Math.ceil(params.rate * 120) + 1;
      for (let i = 0; i < steps; i++) {
        cs.offset.setValueAtTime(Math.random() * 2 - 1, startTime + i / params.rate);
      }
      cs.connect(this.onsetGain);
      cs.start(startTime);
      this.oscNode = cs;
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = params.shape as OscillatorType;
      osc.frequency.value = params.rate;
      osc.connect(this.onsetGain);
      osc.start(startTime);
      this.oscNode = osc;
    }

    const g = this.onsetGain.gain;
    g.cancelScheduledValues(startTime);
    g.setValueAtTime(0, startTime);
    if (params.delay > 0) {
      g.linearRampToValueAtTime(1, startTime + params.delay);
    } else {
      g.setValueAtTime(1, startTime);
    }
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
