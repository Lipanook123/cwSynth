// Soak test: does the engine still make sound after prolonged arpeggiated play?
//
// The failure this exists to catch is progressive — notes go silent one at a
// time over tens of seconds — so it cannot be seen in a short render. Two
// measurements, because the two plausible causes look different:
//
//   1. Per-note cost. Counts AudioParam automation calls and node creations for
//      a single note. A scheduling flood shows up here as a number that is
//      absurd rather than as a number that grows: the Tin Whistle patch once
//      cost 20,181 automation calls per note against 1-3 hundred for everything
//      else, which is 21 ms of blocking main-thread work on every key-down.
//   2. Realtime soak. Runs the arpeggiator against a live AudioContext and
//      samples peak output, live worklet count, pending timers and — the useful
//      one — how fast the audio clock advances against the wall clock. A ratio
//      below the idle baseline means the audio thread is not keeping up.
//
//   node scripts/soak-test.mjs [preset-id] [seconds]
//   ARP_RATE=12 ARP_GATE=0.95 ARP_OCTAVES=3 ARP_NOTES=60,64,67 node scripts/soak-test.mjs obxa-pad 90

import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5198;
const PRESET = process.argv[2] ?? 'tin-whistle';
const SECONDS = Number(process.argv[3] ?? 60);
const RATE = Number(process.env.ARP_RATE ?? 8);
const GATE = Number(process.env.ARP_GATE ?? 0.6);
const OCTAVES = Number(process.env.ARP_OCTAVES ?? 2);
const NOTES = (process.env.ARP_NOTES ?? '60,64,67,71').split(',').map(Number);

const server = await createServer({ root: process.cwd(), server: { port: PORT }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.error('[pageerror]', String(e)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

// ---------------------------------------------------------------- per-note cost

const perNote = await page.evaluate(async (presetId) => {
  const { AudioEngine } = await import('/src/engine/AudioEngine.ts');
  const { FACTORY_PRESETS } = await import('/src/presets/PresetManager.ts');

  const patch = FACTORY_PRESETS.find(p => p.id === presetId)?.patch
    ?? FACTORY_PRESETS[0].patch;

  // Count every automation call and every node construction, engine-wide.
  const counts = { automation: 0, nodes: 0, worklets: 0, workletStops: 0 };
  const AP = AudioParam.prototype;
  const methods = ['setValueAtTime', 'linearRampToValueAtTime',
    'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'];
  const originals = {};
  for (const m of methods) {
    originals[m] = AP[m];
    AP[m] = function (...a) { counts.automation++; return originals[m].apply(this, a); };
  }
  const CtxProto = AudioContext.prototype;
  const factories = ['createGain', 'createOscillator', 'createConstantSource',
    'createBiquadFilter', 'createBufferSource', 'createStereoPanner'];
  const origFactories = {};
  for (const f of factories) {
    origFactories[f] = CtxProto[f];
    CtxProto[f] = function (...a) { counts.nodes++; return origFactories[f].apply(this, a); };
  }
  const RealWorklet = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends RealWorklet {
    constructor(ctx, name, opts) {
      super(ctx, name, opts);
      counts.worklets++;
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (msg) => { if (msg?.type === 'stop') counts.workletStops++; return post(msg); };
    }
  };

  const engine = new AudioEngine();
  await engine.preload();
  engine.loadPatch(patch);

  const before = { ...counts };
  engine._noteOn(60, 0.8);
  const afterOn = { ...counts };
  engine._noteOff(60);

  const result = {
    preset: patch.name,
    lfo1: patch.lfo1, lfo2: patch.lfo2,
    modSlots: patch.modMatrix.filter(s => s.enabled).length,
    automationPerNote: afterOn.automation - before.automation,
    nodesPerNote: afterOn.nodes - before.nodes,
    workletsPerNote: afterOn.worklets - before.worklets,
  };

  for (const m of methods) AP[m] = originals[m];
  for (const f of factories) CtxProto[f] = origFactories[f];
  window.AudioWorkletNode = RealWorklet;
  engine.dispose();
  return result;
}, PRESET);

console.log('\n=== per-note cost ===');
console.log(`preset            ${perNote.preset}`);
console.log(`lfo1              ${JSON.stringify(perNote.lfo1)}`);
console.log(`lfo2              ${JSON.stringify(perNote.lfo2)}`);
console.log(`mod slots         ${perNote.modSlots}`);
console.log(`automation calls  ${perNote.automationPerNote}   <-- per note`);
console.log(`nodes created     ${perNote.nodesPerNote}`);
console.log(`worklets created  ${perNote.workletsPerNote}`);

// ---------------------------------------------------------------- realtime soak

console.log(`\n=== realtime soak (${SECONDS}s, arp on) ===`);

const soakResult = await page.evaluate(async ({ presetId, seconds, rate, gate, octaves, notes }) => {
  // The *singleton* the mounted UI is already driving, not a fresh engine — the
  // scope's animation frames, the log panel's re-renders and the React tree are
  // all part of the load the audio thread has to survive.
  const { engine } = await import('/src/engine/AudioEngine.ts');
  const { FACTORY_PRESETS } = await import('/src/presets/PresetManager.ts');

  const patch = FACTORY_PRESETS.find(p => p.id === presetId)?.patch ?? FACTORY_PRESETS[0].patch;

  // Worklet accounting across the whole soak: created minus stopped is the
  // number of processors still running on the audio thread.
  const live = { created: 0, stopped: 0 };
  const RealWorklet = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends RealWorklet {
    constructor(ctx, name, opts) {
      super(ctx, name, opts);
      live.created++;
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (msg) => { if (msg?.type === 'stop') live.stopped++; return post(msg); };
    }
  };

  // Outstanding timers: voice teardown is deferred with setTimeout, so a growing
  // count means voices are being created faster than they are being freed.
  let pending = 0;
  const realSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    pending++;
    return realSetTimeout.call(this, (...a) => { pending--; return fn(...a); }, ms, ...rest);
  };

  await engine.preload();
  engine.loadPatch(patch);
  engine.resume();
  await new Promise(r => realSetTimeout(r, 300));

  const analyser0 = engine.getAnalyser();
  const ctx0 = analyser0.context;

  // Control: how fast does the audio clock run with nothing playing? Anything
  // below 1.0 under load is only meaningful against this baseline.
  const idleA = ctx0.currentTime, idleW = performance.now();
  await new Promise(r => realSetTimeout(r, 4000));
  const idleClock = (ctx0.currentTime - idleA) / ((performance.now() - idleW) / 1000);

  engine.arp.enabled = true;
  engine.arp.setRate(rate);
  engine.arp.setGate(gate);
  engine.arp.setPattern('up');
  engine.arp.setOctaves(octaves);
  for (const n of notes) engine.noteOn(n, 0.8);

  const analyser = engine.getAnalyser();
  const buf = new Float32Array(analyser.fftSize);
  const samples = [];
  const ctx = analyser.context;

  // Peak-hold over a window: the arp leaves gaps between notes, so a single
  // instantaneous RMS reading is as likely to land in a gap as on a note.
  const windowMs = 2000;
  const t0 = performance.now();
  let lastAudio = ctx.currentTime;
  let lastWall = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    let peak = 0;
    const wEnd = performance.now() + windowMs;
    let frames = 0;
    let lag = 0;
    while (performance.now() < wEnd) {
      const before = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      lag = Math.max(lag, performance.now() - before);
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      frames++;
    }
    // If the audio thread stalls, its clock falls behind the wall clock. That
    // distinguishes "the engine stopped scheduling notes" from "the audio
    // thread can no longer keep up with the processors it is running".
    const nowWall = performance.now();
    const audioAdvance = ctx.currentTime - lastAudio;
    const wallAdvance = (nowWall - lastWall) / 1000;
    lastAudio = ctx.currentTime;
    lastWall = nowWall;

    samples.push({
      t: Math.round((nowWall - t0) / 1000),
      peak: +peak.toFixed(4),
      voices: engine.getVoiceCount(),
      fps: Math.round(frames / (windowMs / 1000)),
      worstFrameMs: Math.round(lag),
      clock: +(audioAdvance / wallAdvance).toFixed(3),
      liveWorklets: live.created - live.stopped,
      stacks: engine.getActiveNotes().size,
      timers: pending,
    });
  }

  engine.arp.enabled = false;
  engine.arp.stop();
  engine.allNotesOff();
  window.AudioWorkletNode = RealWorklet;
  window.setTimeout = realSetTimeout;
  return { idleClock: +idleClock.toFixed(3), samples };
}, { presetId: PRESET, seconds: SECONDS, rate: RATE, gate: GATE, octaves: OCTAVES, notes: NOTES });

console.log(`idle clock ratio  ${soakResult.idleClock}   (1.0 = audio thread keeping up with nothing playing)`);
const soak = soakResult.samples;
console.log('  t(s)   peak   voices  fps  worstFrame  clock  worklets  stacks  timers');
for (const s of soak) {
  console.log(`  ${String(s.t).padStart(4)}  ${s.peak.toFixed(4)}  ${String(s.voices).padStart(6)}  ${String(s.fps).padStart(3)}  ${String(s.worstFrameMs).padStart(10)}  ${s.clock.toFixed(3)}  ${String(s.liveWorklets).padStart(8)}  ${String(s.stacks).padStart(6)}  ${String(s.timers).padStart(6)}`);
}

const first = soak[0]?.peak ?? 0;
const last = soak[soak.length - 1]?.peak ?? 0;
const held = last > first * 0.5;
console.log(`\n${held ? 'PASS' : 'FAIL'}: peak went ${first.toFixed(4)} -> ${last.toFixed(4)}`);

await browser.close();
await server.close();
process.exit(held ? 0 : 1);
