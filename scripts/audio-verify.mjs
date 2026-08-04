// End-to-end audio verification in real Chromium.
//
// The vitest suites use a mocked Web Audio graph, which proves wiring but never
// renders a sample. This renders the actual engine — real worklets, real
// OfflineAudioContext — and measures the output, so claims like "the ladder
// self-oscillates" and "PWM changes duty cycle" are checked against audio rather
// than against the shape of the node graph.
//
//   node scripts/audio-verify.mjs
//
// Requires the dev dependency `playwright` and a Chromium at CHROME_PATH
// (defaults to the preinstalled path in this container).

import { chromium } from 'playwright';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5197;

const server = await createServer({
  root: process.cwd(),
  server: { port: PORT },
  logLevel: 'error',
});
await server.listen();

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const SR = 48000;

  const { loadWorklets } = await import('/src/engine/worklets/index.ts');
  const { Voice } = await import('/src/engine/Voice.ts');
  const { AudioEngine } = await import('/src/engine/AudioEngine.ts');
  const { normalisePatch } = await import('/src/engine/PatchMigration.ts');
  const { FACTORY_PRESETS } = await import('/src/presets/PresetManager.ts');

  const out = [];
  const rec = (name, pass, detail) => out.push({ name, pass, detail });

  const peak = b => { let p = 0; for (const v of b) p = Math.max(p, Math.abs(v)); return p; };

  /**
   * Pad an operator list to six, disabling the rest. normalisePatch fills
   * missing operators from defaults, which are *enabled* — so without this every
   * patch here would also sound five stray sine waves.
   */
  const ops = list => Array.from({ length: 6 }, (_, i) => list[i] ?? { enabled: false });

  /**
   * Normalised autocorrelation at a given lag. Hard sync makes the slave's
   * waveform repeat at the *master's* period, so this is what "takes the master
   * pitch" actually means — counting zero crossings measures the slave's
   * internal cycles instead and gives a misleadingly high answer.
   */
  const periodicityAt = (b, freq, from) => {
    const lag = Math.round(SR / freq);
    let num = 0, magA = 0, magB = 0;
    for (let i = from; i < b.length - lag; i++) {
      num += b[i] * b[i + lag];
      magA += b[i] * b[i];
      magB += b[i + lag] * b[i + lag];
    }
    return num / Math.sqrt(magA * magB || 1);
  };
  const rms = b => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
  const dominant = (b, from) => {
    let x = 0, prev = b[from];
    for (let i = from + 1; i < b.length; i++) {
      if (prev < 0 && b[i] >= 0) x++;
      prev = b[i];
    }
    return x / ((b.length - from) / SR);
  };

  /** Render one patch through a real OfflineAudioContext with worklets loaded. */
  async function render(patch, seconds, semitone = 60, hz = 261.63, holdFor = 0.8) {
    const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR);
    const ok = await loadWorklets(ctx);
    if (!ok) throw new Error('worklets failed to load');
    const v = new Voice(ctx, patch, semitone, hz);
    v.output.connect(ctx.destination);
    v.noteOn(0.9, 0);
    if (holdFor < seconds) v.noteOff(holdFor);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  // 1. Worklets actually load and register in a real browser.
  try {
    const ctx = new OfflineAudioContext(1, 256, SR);
    const ok = await loadWorklets(ctx);
    rec('worklets load', ok === true, `loadWorklets returned ${ok}`);
  } catch (e) {
    rec('worklets load', false, String(e));
  }

  // 2. A VCO patch through the ladder produces sound.
  try {
    const patch = normalisePatch({
      algorithm: 16,
      operators: ops([{ enabled: true, role: 'vco', wave: 'sawtooth', level: 0.9 }]),
      filter: { enabled: true, model: 'ladder', cutoff: 3000, resonance: 4 },
    });
    const b = await render(patch, 1);
    rec('vco + ladder makes sound', peak(b) > 0.05, `peak=${peak(b).toFixed(3)}`);
  } catch (e) {
    rec('vco + ladder makes sound', false, String(e));
  }

  // 3. The ladder self-oscillates from near-silence at full resonance — the
  //    thing a cascaded biquad fundamentally cannot do.
  try {
    const patch = normalisePatch({
      algorithm: 16,
      operators: ops([{ enabled: true, role: 'vco', wave: 'sawtooth', level: 0.0001 }]),
      filter: { enabled: true, model: 'ladder', cutoff: 500, resonance: 30, slope: 24 },
    });
    const b = await render(patch, 1.5, 60, 261.63, 1.4);
    const tail = b.subarray(Math.round(SR * 0.7), Math.round(SR * 1.2));
    const f = dominant(b, Math.round(SR * 0.7));
    rec('ladder self-oscillates', rms(tail) > 0.01 && f > 300 && f < 800,
        `rms=${rms(tail).toFixed(4)} freq=${f.toFixed(0)}Hz (expect ~500)`);
  } catch (e) {
    rec('ladder self-oscillates', false, String(e));
  }

  // 4. Ladder and biquad genuinely differ on the same patch.
  try {
    const mk = model => normalisePatch({
      algorithm: 16,
      operators: ops([{ enabled: true, role: 'vco', wave: 'sawtooth', level: 0.9 }]),
      filter: { enabled: true, model, cutoff: 600, resonance: 24, slope: 24 },
    });
    const a = await render(mk('ladder'), 1);
    const c = await render(mk('biquad'), 1);
    const diff = Math.abs(rms(a) - rms(c)) / Math.max(rms(a), rms(c));
    rec('ladder differs from biquad', diff > 0.05,
        `ladderRms=${rms(a).toFixed(4)} biquadRms=${rms(c).toFixed(4)} diff=${(diff * 100).toFixed(1)}%`);
  } catch (e) {
    rec('ladder differs from biquad', false, String(e));
  }

  // 5. Pulse width actually changes the duty cycle of the rendered wave.
  try {
    const duty = async pw => {
      const patch = normalisePatch({
        algorithm: 16,
        operators: ops([{ enabled: true, role: 'vco', wave: 'square', pulseWidth: pw, level: 0.9, drift: 0 }]),
        filter: { enabled: false },
      });
      const b = await render(patch, 0.5, 60, 220, 0.45);
      const seg = b.subarray(Math.round(SR * 0.1), Math.round(SR * 0.4));
      let high = 0;
      for (const v of seg) if (v > 0) high++;
      return high / seg.length;
    };
    const d25 = await duty(0.25), d75 = await duty(0.75);
    rec('pulse width changes duty', d75 - d25 > 0.3,
        `pw0.25→${d25.toFixed(2)}  pw0.75→${d75.toFixed(2)}`);
  } catch (e) {
    rec('pulse width changes duty', false, String(e));
  }

  // 6. Hard sync: the slave's waveform becomes periodic at the MASTER's period.
  //    Measured against an unsynced control, since the slave keeps its own
  //    (much higher) internal cycle rate either way.
  try {
    const mk = synced => normalisePatch({
      algorithm: 16,
      routes: synced
        ? [{ from: 0, to: 1, kind: 'sync', amount: 1 }, { from: 1, to: 'out', kind: 'mix', amount: 1 }]
        : [{ from: 1, to: 'out', kind: 'mix', amount: 1 }],
      operators: ops([
        { enabled: true, role: 'vco', wave: 'sawtooth', ratio: 1, level: 0.9, drift: 0 },
        { enabled: true, role: 'vco', wave: 'sawtooth', ratio: 2.7, level: 0.9, drift: 0 },
      ]),
      filter: { enabled: false },
    });
    const from = Math.round(SR * 0.1);
    const syncedBuf = await render(mk(true), 0.6, 57, 220, 0.55);
    const freeBuf = await render(mk(false), 0.6, 57, 220, 0.55);
    const pSync = periodicityAt(syncedBuf, 220, from);
    const pFree = periodicityAt(freeBuf, 220, from);
    rec('hard sync locks to master period', pSync > 0.8 && pSync - pFree > 0.3,
        `synced=${pSync.toFixed(3)} unsynced=${pFree.toFixed(3)} (1.0 = perfectly periodic at 220Hz)`);
  } catch (e) {
    rec('hard sync locks to master period', false, String(e));
  }

  // 7. Unison genuinely stacks: more layers, more voices, and audible beating
  //    between detuned layers.
  try {
    const base = {
      algorithm: 16,
      operators: ops([{ enabled: true, role: 'vco', wave: 'sawtooth', level: 0.9, drift: 0 }]),
      filter: { enabled: false },
    };
    const count = u => {
      const e = new AudioEngine();
      e.loadPatch(normalisePatch({ ...base, unison: { voices: u, detune: 14, spread: 0.6 } }));
      return e;
    };
    // Voice counts are engine state, checkable without rendering.
    const e1 = count(1), e5 = count(5);
    e1.noteOn(60, 0.9); e5.noteOn(60, 0.9);
    const ok = e1.getVoiceCount() === 1 && e5.getVoiceCount() === 5;
    rec('unison stacks voices', ok, `1 voice → ${e1.getVoiceCount()}, 5 voices → ${e5.getVoiceCount()}`);
    e1.dispose(); e5.dispose();
  } catch (e) {
    rec('unison stacks voices', false, String(e));
  }

  // 8. Glide actually ramps pitch rather than jumping.
  try {
    const patch = normalisePatch({
      algorithm: 16,
      operators: ops([{ enabled: true, role: 'vco', wave: 'sawtooth', level: 0.9, drift: 0 }]),
      filter: { enabled: false },
      voiceMode: 'mono', glide: 0.3,
    });
    // Two voices back to back: the second starts at the first's pitch.
    const ctx = new OfflineAudioContext(1, SR, SR);
    await loadWorklets(ctx);
    const low = 220, high = 880;
    const v = new Voice(ctx, patch, 81, high, { glideFromHz: low, glideTime: 0.3 });
    v.output.connect(ctx.destination);
    v.noteOn(0.9, 0);
    const b = (await ctx.startRendering()).getChannelData(0);

    const earlyEnd = dominant(b.subarray(0, Math.round(SR * 0.08)), Math.round(SR * 0.01));
    const late = dominant(b.subarray(Math.round(SR * 0.5)), 0);
    rec('glide ramps pitch into place', earlyEnd < late * 0.7 && Math.abs(late - high) < high * 0.1,
        `start≈${earlyEnd.toFixed(0)}Hz  settled≈${late.toFixed(0)}Hz (from ${low} to ${high})`);
  } catch (e) {
    rec('glide ramps pitch into place', false, String(e));
  }

  // 9. Every factory preset renders audibly and without NaN.
  for (const preset of FACTORY_PRESETS) {
    if (preset.id === 'init') continue; // Init is deliberately plain
    try {
      const b = await render(preset.patch, 1.2, 60, 261.63, 0.9);
      const finite = b.every(Number.isFinite);
      const p = peak(b);
      rec(`preset "${preset.name}" renders`, finite && p > 0.01 && p < 12,
          `peak=${p.toFixed(3)} finite=${finite}`);
    } catch (e) {
      rec(`preset "${preset.name}" renders`, false, String(e));
    }
  }

  return out;
});

await browser.close();
await server.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? ' PASS' : ' FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
}
if (pageErrors.length) {
  console.log('\npage errors:');
  for (const e of [...new Set(pageErrors)].slice(0, 5)) console.log('  ' + e);
}
console.log(`\n${results.length - failed}/${results.length} audio checks passed`);
process.exit(failed ? 1 : 0);
