// How much audio-thread headroom is there, and what actually consumes it?
//
//   node scripts/dsp-headroom.mjs
//
// The metric throughout is how fast `ctx.currentTime` advances against the wall
// clock. At 1.0 the audio thread renders in real time with room to spare; below
// that it is behind, which on real hardware is a glitch rather than a slow
// clock. Everything is measured against an idle baseline, because that ratio is
// only meaningful relative to what the machine does with nothing playing.
//
// Three questions, in order:
//
//   1. Does node count cost anything?  (native nodes, then worklet nodes)
//   2. Where does our DSP arithmetic run out?  (ladder filters, packed many to
//      a node so the count of nodes stays small and constant)
//   3. Does the engine spend its budget on voices you can hear?  (a held chord
//      against an arpeggio, comparing worklets alive to voices sounding)
//
// Question 3 is the one that matters for design decisions. A held chord and an
// arpeggio ask for similar arithmetic; if the arpeggio costs far more, the
// engine is keeping dead voices running, and no amount of faster DSP fixes it.

import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5194;

const server = await createServer({ root: process.cwd(), server: { port: PORT }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.error('[pageerror]', String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

const rows = await page.evaluate(async () => {
  const { loadWorklets } = await import('/src/engine/worklets/index.ts');
  const { AudioEngine } = await import('/src/engine/AudioEngine.ts');
  const { FACTORY_PRESETS } = await import('/src/presets/PresetManager.ts');
  const out = [];

  // ---- graph and DSP limits, on a context of their own -------------------
  {
    const ctx = new AudioContext();
    await loadWorklets(ctx);
    await ctx.resume();
    const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
    let made = [];

    const clear = async () => {
      for (const n of made) {
        try { n.port?.postMessage({ type: 'stop' }); } catch {}
        try { n.stop?.(); } catch {}
        try { n.disconnect(); } catch {}
      }
      made = [];
      await new Promise(r => setTimeout(r, 1200));
    };
    const clock = async (ms = 3000) => {
      const a = ctx.currentTime, w = performance.now();
      await new Promise(r => setTimeout(r, ms));
      return +((ctx.currentTime - a) / ((performance.now() - w) / 1000)).toFixed(3);
    };

    await clear();
    out.push({ group: 'baseline', label: 'idle', detail: '', ratio: await clock() });

    for (const n of [256, 1024]) {
      await clear();
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 220;
        const g = ctx.createGain(); g.gain.value = 0.001;
        o.connect(g); g.connect(sink); o.start(); made.push(o, g);
      }
      out.push({ group: 'graph size', label: `${n} native osc+gain pairs`, detail: `${n * 2} nodes`, ratio: await clock() });
    }

    // The ladder processor builds one filter per output channel, so the same
    // arithmetic can be spread over many nodes or packed into few. Comparing
    // the two separates node overhead from sample throughput.
    for (const perNode of [1, 16]) {
      await clear();
      for (let i = 0; i < 256 / perNode; i++) {
        const n = new AudioWorkletNode(ctx, 'cw-ladder-filter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [perNode],
        });
        n.parameters.get('cutoff').value = 900;
        n.parameters.get('resonance').value = 0.7; // self-oscillating: really working
        n.connect(sink); made.push(n);
      }
      out.push({ group: 'graph size', label: `256 ladder filters, ${perNode}/node`, detail: `${256 / perNode} worklet nodes`, ratio: await clock() });
    }

    for (const total of [512, 1024, 2048]) {
      await clear();
      for (let i = 0; i < total / 32; i++) {
        const n = new AudioWorkletNode(ctx, 'cw-ladder-filter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [32],
        });
        n.parameters.get('cutoff').value = 900;
        n.parameters.get('resonance').value = 0.7;
        n.connect(sink); made.push(n);
      }
      out.push({ group: 'dsp throughput', label: `${total} ladder filters`, detail: `${total / 32} worklet nodes`, ratio: await clock() });
    }

    await clear();
    await ctx.close();
  }

  // ---- what the engine does with its budget -----------------------------
  {
    const base = FACTORY_PRESETS.find(p => p.id === 'obxa-pad').patch;
    const live = { n: 0 };
    const Real = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Real {
      constructor(ctx, name, opts) {
        super(ctx, name, opts);
        live.n++;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (m) => { if (m?.type === 'stop') live.n--; return post(m); };
      }
    };

    const engine = new AudioEngine();
    await engine.preload(); engine.resume();
    await new Promise(r => setTimeout(r, 400));
    const ctx = engine.getAnalyser().context;
    const clock = async (ms) => {
      const a = ctx.currentTime, w = performance.now();
      await new Promise(r => setTimeout(r, ms));
      return +((ctx.currentTime - a) / ((performance.now() - w) / 1000)).toFixed(3);
    };
    const reset = async () => {
      engine.arp.enabled = false; engine.arp.stop(); engine.allNotesOff();
      await new Promise(r => setTimeout(r, 2500));
    };
    const load = (unison) => engine.loadPatch({
      ...base, unison: { ...base.unison, voices: unison }, polyphony: 24,
    });

    for (const [unison, notes] of [[3, 4], [3, 8], [1, 8]]) {
      await reset(); load(unison);
      for (let i = 0; i < notes; i++) engine.noteOn(52 + i * 3, 0.8);
      await new Promise(r => setTimeout(r, 800));
      const voices = engine.getVoiceCount(), worklets = live.n;
      out.push({ group: 'engine — held', label: `${notes} notes x${unison} unison`,
                 detail: `${worklets} worklets / ${voices} voices`, ratio: await clock(3000) });
    }

    for (const unison of [3, 1]) {
      await reset(); load(unison);
      engine.arp.enabled = true;
      engine.arp.setRate(12); engine.arp.setGate(0.95); engine.arp.setOctaves(3);
      for (const n of [60, 63, 67, 70, 74]) engine.noteOn(n, 0.8);
      await new Promise(r => setTimeout(r, 2000));
      const voices = engine.getVoiceCount(), worklets = live.n;
      out.push({ group: 'engine — arp', label: `12 steps/s x${unison} unison`,
                 detail: `${worklets} worklets / ${voices} voices`, ratio: await clock(4000) });
    }

    await reset();
    window.AudioWorkletNode = Real;
  }

  return out;
});

let group = '';
console.log(`${''.padEnd(34)} ${'detail'.padEnd(28)} clock`);
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.label.padEnd(32)} ${r.detail.padEnd(28)} ${r.ratio}`);
}
console.log('\nclock 1.0 = audio thread rendering in real time; lower = falling behind.');

await browser.close();
await server.close();
process.exit(0);
