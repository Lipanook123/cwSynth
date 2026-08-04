import { describe, it, expect } from 'vitest';
import { LadderFilter } from '../LadderFilter';
import { StateVariableFilter } from '../StateVariableFilter';

const SR = 48000;

/** Peak amplitude of the steady-state response to a sine at `freq`. */
function responseAt(
  filter: { process: (x: number, c: number, r: number, d?: number, s?: 12 | 24, m?: never) => number },
  freq: number,
  cutoff: number,
  resonance = 0,
  slope: 12 | 24 = 24,
) {
  const settle = Math.round(SR * 0.25);
  const measure = Math.round(SR * 0.1);
  let peak = 0;
  for (let i = 0; i < settle + measure; i++) {
    const x = Math.sin((2 * Math.PI * freq * i) / SR);
    const y = filter.process(x, cutoff, resonance, 0, slope, undefined as never);
    if (i >= settle) peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}

const dB = (a: number) => 20 * Math.log10(Math.max(a, 1e-12));

/** Dominant frequency via zero-crossing counting over the tail of a buffer. */
function dominantFreq(buf: Float32Array, from: number): number {
  let crossings = 0;
  let prev = buf[from];
  for (let i = from + 1; i < buf.length; i++) {
    if ((prev < 0 && buf[i] >= 0) || (prev > 0 && buf[i] <= 0)) crossings++;
    prev = buf[i];
  }
  const seconds = (buf.length - from) / SR;
  return crossings / 2 / seconds;
}

describe('LadderFilter', () => {
  it('passes signal well below cutoff essentially untouched', () => {
    const f = new LadderFilter(SR);
    const gain = responseAt(f, 100, 4000);
    expect(dB(gain)).toBeGreaterThan(-1.5);
  });

  it('rolls off at roughly 24 dB/octave in 4-pole mode', () => {
    // Measure across two octaves well above cutoff, where the asymptotic slope
    // has settled.
    const cutoff = 500;
    const a = responseAt(new LadderFilter(SR), cutoff * 4, cutoff, 0, 24);
    const b = responseAt(new LadderFilter(SR), cutoff * 8, cutoff, 0, 24);
    const perOctave = dB(b) - dB(a);
    expect(perOctave).toBeLessThan(-20);
    expect(perOctave).toBeGreaterThan(-28);
  });

  it('rolls off at roughly 12 dB/octave in 2-pole mode', () => {
    const cutoff = 500;
    const a = responseAt(new LadderFilter(SR), cutoff * 4, cutoff, 0, 12);
    const b = responseAt(new LadderFilter(SR), cutoff * 8, cutoff, 0, 12);
    const perOctave = dB(b) - dB(a);
    expect(perOctave).toBeLessThan(-9);
    expect(perOctave).toBeGreaterThan(-15);
  });

  it('produces a resonant peak near cutoff as resonance rises', () => {
    const cutoff = 1000;
    const flat = responseAt(new LadderFilter(SR), cutoff, cutoff, 0);
    const resonant = responseAt(new LadderFilter(SR), cutoff, cutoff, 0.8);
    expect(dB(resonant) - dB(flat)).toBeGreaterThan(6);
  });

  it('self-oscillates from silence at full resonance', () => {
    const f = new LadderFilter(SR);
    const cutoff = 800;
    const buf = new Float32Array(SR); // 1 second of nothing but feedback
    for (let i = 0; i < buf.length; i++) buf[i] = f.process(0, cutoff, 1);

    const tail = buf.subarray(SR / 2);
    let peak = 0;
    for (const v of tail) peak = Math.max(peak, Math.abs(v));

    expect(peak).toBeGreaterThan(0.05);        // it sings
    expect(peak).toBeLessThan(10);             // and stays bounded
    expect(dominantFreq(buf, SR / 2)).toBeGreaterThan(cutoff * 0.7);
    expect(dominantFreq(buf, SR / 2)).toBeLessThan(cutoff * 1.4);
  });

  it('does not self-oscillate at low resonance', () => {
    const f = new LadderFilter(SR);
    let peak = 0;
    for (let i = 0; i < SR; i++) peak = Math.max(peak, Math.abs(f.process(0, 800, 0.2)));
    expect(peak).toBeLessThan(0.01);
  });

  it('stays finite and bounded across the whole parameter space', () => {
    // Naive ladder implementations blow up at high resonance and low cutoff.
    for (const cutoff of [20, 100, 1000, 8000, 20000]) {
      for (const res of [0, 0.5, 0.9, 1]) {
        for (const drive of [0, 0.5, 1]) {
          const f = new LadderFilter(SR);
          let peak = 0;
          for (let i = 0; i < 4000; i++) {
            const x = Math.sin((2 * Math.PI * 220 * i) / SR);
            const y = f.process(x, cutoff, res, drive);
            expect(Number.isFinite(y), `cutoff=${cutoff} res=${res} drive=${drive}`).toBe(true);
            peak = Math.max(peak, Math.abs(y));
          }
          expect(peak, `cutoff=${cutoff} res=${res} drive=${drive}`).toBeLessThan(50);
        }
      }
    }
  });

  it('survives a fast cutoff sweep without blowing up', () => {
    const f = new LadderFilter(SR);
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      const cutoff = 40 + 12000 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 8 * i) / SR));
      const y = f.process(Math.sin((2 * Math.PI * 110 * i) / SR), cutoff, 0.85);
      expect(Number.isFinite(y)).toBe(true);
      peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeLessThan(50);
  });

  it('highpass attenuates below cutoff', () => {
    const hpPeak = (freq: number) => {
      const h = new LadderFilter(SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.3; i++) {
        const y = h.process(Math.sin((2 * Math.PI * freq * i) / SR), 2000, 0, 0, 24, 'hp');
        if (i > SR * 0.2) peak = Math.max(peak, Math.abs(y));
      }
      return peak;
    };
    expect(dB(hpPeak(8000)) - dB(hpPeak(100))).toBeGreaterThan(20);
  });

  it('drive adds harmonic content', () => {
    const measure = (drive: number) => {
      const f = new LadderFilter(SR);
      let sum = 0;
      for (let i = 0; i < SR * 0.2; i++) {
        const y = f.process(Math.sin((2 * Math.PI * 220 * i) / SR) * 0.9, 18000, 0, drive);
        sum += y * y;
      }
      return sum;
    };
    // Saturation reshapes the wave; energy should differ measurably.
    expect(Math.abs(measure(1) - measure(0))).toBeGreaterThan(0);
  });
});

describe('StateVariableFilter', () => {
  it('passes low frequencies and rejects high ones in lowpass mode', () => {
    const low = responseAt(new StateVariableFilter(SR), 100, 2000, 0, 12);
    const high = responseAt(new StateVariableFilter(SR), 12000, 2000, 0, 12);
    expect(dB(low)).toBeGreaterThan(-1.5);
    expect(dB(low) - dB(high)).toBeGreaterThan(20);
  });

  it('rolls off at roughly 12 dB/octave', () => {
    const cutoff = 500;
    const a = responseAt(new StateVariableFilter(SR), cutoff * 4, cutoff, 0, 12);
    const b = responseAt(new StateVariableFilter(SR), cutoff * 8, cutoff, 0, 12);
    const perOctave = dB(b) - dB(a);
    expect(perOctave).toBeLessThan(-9);
    expect(perOctave).toBeGreaterThan(-15);
  });

  it('is steeper when run at 24 dB/oct', () => {
    const cutoff = 500;
    const slope = (s: 12 | 24) => {
      const a = responseAt(new StateVariableFilter(SR), cutoff * 4, cutoff, 0, s);
      const b = responseAt(new StateVariableFilter(SR), cutoff * 8, cutoff, 0, s);
      return dB(b) - dB(a);
    };
    expect(slope(24)).toBeLessThan(slope(12));
  });

  it('resonates near cutoff', () => {
    const cutoff = 1000;
    const flat = responseAt(new StateVariableFilter(SR), cutoff, cutoff, 0, 12);
    const resonant = responseAt(new StateVariableFilter(SR), cutoff, cutoff, 0.9, 12);
    expect(dB(resonant) - dB(flat)).toBeGreaterThan(6);
  });

  it('gives a highpass that rejects lows', () => {
    const run = (freq: number) => {
      const f = new StateVariableFilter(SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.3; i++) {
        const y = f.process(Math.sin((2 * Math.PI * freq * i) / SR), 2000, 0, 0, 12, 'hp');
        if (i > SR * 0.2) peak = Math.max(peak, Math.abs(y));
      }
      return peak;
    };
    expect(dB(run(8000)) - dB(run(100))).toBeGreaterThan(20);
  });

  it('stays finite across the parameter space', () => {
    for (const cutoff of [20, 100, 1000, 8000, 20000]) {
      for (const res of [0, 0.5, 0.9, 1]) {
        const f = new StateVariableFilter(SR);
        for (let i = 0; i < 4000; i++) {
          const y = f.process(Math.sin((2 * Math.PI * 220 * i) / SR), cutoff, res, 0.5);
          expect(Number.isFinite(y), `cutoff=${cutoff} res=${res}`).toBe(true);
        }
      }
    }
  });
});
