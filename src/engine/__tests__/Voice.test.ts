import { describe, it, expect, beforeEach } from 'vitest';
import { Voice } from '../Voice';
import { levelToIndex } from '../Operator';
import { DEFAULT_PATCH, type PatchParams } from '../Types';
import { adsrToEnv } from '../Envelope';
import { FakeGain, FakeParam, makeCtx as ctx } from './fakeAudio';



/** All oscillator frequency params reachable in the graph, by construction order. */
function patchWith(over: Partial<PatchParams>): PatchParams {
  return { ...structuredClone(DEFAULT_PATCH), ...over };
}

describe('Voice FM routing', () => {
  let patch: PatchParams;

  beforeEach(() => {
    patch = patchWith({
      algorithm: 5, // (6→5)+(4→3)+(2→1): op2 modulates op1
      operators: DEFAULT_PATCH.operators.map((op, i) => ({
        ...op,
        enabled: i < 2,
        level: i === 0 ? 1 : 0.8,
        ratio: i === 0 ? 1 : 2,
        env: adsrToEnv(0.001, 0.3, 0.5, 0.3),
      })),
    });
  });

  it('routes a modulator to the carrier frequency and not its amplitude', () => {
    // This is the exact shape of the original defect: routing was built before
    // the oscillators existed, so getFrequencyParam() fell back to the target's
    // envelope gain and every algorithm did AM instead of FM.
    const v = new Voice(ctx(), patch, 69, 440);
    v.noteOn(1, 0);

    const ops = (v as never as {
      operators: {
        getFrequencyParam(): FakeParam | null;
        getEnvParam(): FakeParam;
        unitOut: FakeGain;
      }[];
    }).operators;

    const carrierFreq = ops[0].getFrequencyParam();
    const carrierAmp = ops[0].getEnvParam();
    expect(carrierFreq).not.toBeNull();

    // Everything op2's output reaches, one hop through its route gain.
    const reached = ops[1].unitOut.connections
      .flatMap(c => (c.target instanceof FakeGain ? c.target.connections.map(x => x.target) : []));

    expect(reached).toContain(carrierFreq);
    expect(reached).not.toContain(carrierAmp);
  });

  it('scales FM depth by index x modulator frequency', () => {
    const v = new Voice(ctx(), patch, 69, 440);
    v.noteOn(1, 0);

    const carrierFreq = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] })
      .operators[0].getFrequencyParam() as unknown as FakeParam;

    // op2: level 0.8, ratio 2 at A440 → modulator runs at 880 Hz.
    const expected = levelToIndex(0.8) * 880;
    const depths = carrierFreq.incoming.map(g => g.gain.value);
    expect(depths).toContainEqual(expected);
  });

  it('keeps the index constant across the keyboard', () => {
    // Same patch two octaves apart: deviation should scale with pitch, so the
    // ratio deviation/frequency (the index) stays put. This is the property that
    // stops high notes going dull.
    const depthAt = (hz: number) => {
      const v = new Voice(ctx(), patch, 69, hz);
      v.noteOn(1, 0);
      const freq = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] })
        .operators[0].getFrequencyParam() as unknown as FakeParam;
      return Math.max(...freq.incoming.map(g => g.gain.value));
    };
    const low = depthAt(110);
    const high = depthAt(440);
    expect(high / low).toBeCloseTo(4, 4);
  });

  it('does not route into a disabled operator', () => {
    patch.operators[1].enabled = false;
    const v = new Voice(ctx(), patch, 69, 440);
    v.noteOn(1, 0);
    const carrierFreq = (v as never as { operators: { getFrequencyParam(): FakeParam | null }[] })
      .operators[0].getFrequencyParam() as unknown as FakeParam;
    // Only self-feedback remains (feedback is 0, but the node is still wired).
    const depths = carrierFreq.incoming.map(g => g.gain.value);
    expect(depths).not.toContainEqual(levelToIndex(0.8) * 880);
  });

  it('survives a Karplus-Strong operator as an FM target', () => {
    // KS operators have no oscillator, so getFrequencyParam() returns null and
    // the route must be skipped rather than throwing.
    patch.operators[0].karplusStrong = true;
    const v = new Voice(ctx(), patch, 69, 440);
    expect(() => v.noteOn(1, 0)).not.toThrow();
  });

  it('reports release time from enabled operators only', () => {
    patch.operators[5].enabled = false;
    patch.operators[5].env = adsrToEnv(0.01, 0.3, 0.5, 8); // long release, muted op
    const v = new Voice(ctx(), patch, 69, 440);
    expect(v.releaseTime()).toBeCloseTo(0.3, 6);
  });

  it('does not apply patch volume at the voice (master applies it once)', () => {
    patch.volume = 0.5;
    const v = new Voice(ctx(), patch, 69, 440);
    expect(v.output.gain.value).toBe(1);
  });
});
