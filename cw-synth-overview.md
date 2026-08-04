# CW Synth — Technical Overview

**A 6-operator FM synthesiser for the browser, built with Vite, React, TypeScript, and the Web Audio API.**

---

## What It Is

CW Synth is a browser-based FM (frequency modulation) synthesiser inspired by the architecture of the Yamaha DX7. It runs entirely client-side with no server required — audio synthesis, patch storage, and all UI interaction happen within a single static web application. Patches are saved as `.cwsyn` files, which are plain JSON and designed to be shared, version-controlled, and diff-friendly.

The project grew out of an earlier single-file whistle/flute synthesiser (`fm-synth-3.html`) and has been rebuilt as a proper multi-file TypeScript project with a clean separation between audio engine and UI.

---

## Architecture

### Tech Stack

| Layer | Technology |
|---|---|
| Build tooling | Vite 7 |
| Language | TypeScript (strict) |
| UI framework | React 19 |
| Audio engine | Web Audio API (no library) |
| Styling | CSS custom properties, IBM Plex fonts |
| Patch format | JSON (`.cwsyn`) |

### Project Structure

```
src/
  engine/
    AudioEngine.ts      — voice lifecycle, polyphony/stealing, global FX modulation
    Voice.ts            — 6-operator voice; builds the routing matrix at note-on
    Operator.ts         — single operator: oscillator, feedback, Karplus-Strong, index curve
    Envelope.ts         — N-stage rate/level envelope generator
    Algorithms.ts       — 32 DX7 topologies + expansion to the routing matrix
    Lfo.ts              — LFO shapes, swing, delayed onset
    Arpeggiator.ts      — lookahead scheduler with voice pooling
    Randomiser.ts       — seeded PRNG, constrained + wild parameter ranges
    PatchMigration.ts   — patch validation, deep-merge defaults, v1→v2 upgrade
    Types.ts            — full TypeScript interfaces for all patch data
    __tests__/          — vitest unit tests (envelopes, routing, migration)
  fx/
    FxChain.ts          — global effects bus (reverb, delay, chorus, dist, EQ)
  presets/
    PresetManager.ts    — factory presets, user save/load, .cwsyn import/export
  ui/
    App.tsx             — main shell: tabs, topbar, theme, randomiser state
    components/
      OperatorPanel.tsx — per-operator controls (wave, ADSR, ratio, feedback)
      AlgorithmView.tsx — algorithm selector with live SVG diagram
      FilterPanel.tsx   — resonant filter with envelope
      FxPanel.tsx       — effects chain controls
      ArpPanel.tsx      — arpeggiator controls
      PresetBrowser.tsx — factory + user preset list, import/export
      Keyboard.tsx      — on-screen piano keyboard
      Scope.tsx         — oscilloscope (canvas, Web Audio analyser)
      LfoPanel.tsx      — LFO 1/2 shape, rate, depth, delay, swing
      ModMatrix.tsx     — mod routing editor grouped by destination
      VoicePanel.tsx    — voice mode, note priority, glide, unison
      AdsrKnobs.tsx     — envelope editor; ADSR knobs or per-stage rate/level grid
      Knob.tsx          — reusable rotary knob (drag, scroll, double-click to type)
      RandomControls.tsx — dice button, seed input, safe/wild toggle
    hooks/
      useEngine.ts      — React ↔ audio engine bridge
      useKeyboard.ts    — computer keyboard + MIDI input
```

---

## Implemented Features

### FM Engine

**6 operators** per voice, each with:

- Selectable waveform: sine, triangle, sawtooth, square (wavetable type defined but editor not yet built)
- Frequency ratio (0.5–16×) and fine detune (±100 cents), or fixed-frequency mode
- N-stage rate/level envelope with exponential or linear segments, velocity
  sensitivity, and DX-7 key rate/level scaling
- Self-feedback loop (operator modulating its own frequency), scaled by the
  operator's frequency so it holds across the keyboard
- Per-operator enable/disable

**32 algorithms** — the full DX7 topology set. Each algorithm defines which operators are carriers (routed to audio output) and which are modulators (routed to another operator's frequency input). `expandAlgorithm()` turns them into a general routing matrix (`Route[]`), which `Voice.ts` builds on each note-on — after the operators' oscillators exist, so the frequency inputs are reachable. A patch may supply its own `routes` array to override the algorithm.

**Modulation index** — a modulator's `level` maps through an exponential curve to an FM index (max 10), and the resulting depth is scaled by the modulator's own frequency. That scaling is what keeps a patch's timbre constant across the keyboard.

**Karplus-Strong physical modelling** — any operator can be switched to KS mode, replacing its oscillator with a noise burst fed into a delay/filter feedback loop. Produces plucked string and percussion timbres. Decay rate is adjustable.

**Voice management** — voices are created on note-on and disposed after their release phase completes. The AudioContext is lazily initialised on the first user gesture to comply with browser autoplay policy.

### Resonant Filter

Per-voice biquad (12 dB/oct) inserted between the carrier mix and the output. Supports lowpass, highpass, bandpass, and notch modes. Parameters:

- Cutoff frequency (20Hz–20kHz)
- Resonance / Q (0.1–30)
- Dedicated envelope with adjustable depth (−1 to +1, scales ±4 octaves), applied
  as an additive offset so it composes with key tracking and LFO modulation
- Key tracking (0–100%, scales cutoff with MIDI note)

### Analog Oscillators and Filters (AudioWorklet)

Three things are impossible with Web Audio's stock nodes: hard sync (an
`OscillatorNode`'s phase is unreachable), pulse-width modulation (there is no
pulse oscillator), and a self-oscillating resonant ladder (cascaded biquads have
entirely the wrong resonance behaviour). Two worklet processors close that gap.

**`cw-analog-osc`** — PolyBLEP sawtooth, pulse, triangle and sine with a-rate
frequency and pulse width, hard sync via an audio-rate input, random start phase,
and slow pitch drift. Measured at roughly 50× less aliasing than a naive
oscillator at the same pitch.

**`cw-ladder-filter`** — a Moog-style 4-pole ladder using a zero-delay-feedback
(TPT) topology with a tanh-limited feedback path, plus a state-variable model for
the softer Oberheim character. Both offer 12/24 dB slopes, lowpass/highpass/
bandpass/notch, input drive, and self-oscillation at full resonance.

The DSP itself lives in plain classes under `src/engine/dsp/`, so it is unit
tested over sample buffers with no browser involved; the worklets are thin
wrappers. Because a worklet's `AudioParam`s behave exactly like an oscillator's
or a biquad's, FM routing, envelopes and the mod matrix all work against them
unchanged.

Worklet modules load asynchronously while `noteOn` is synchronous, so the engine
preloads them on mount (an `AudioContext` may be created suspended without a user
gesture) and falls back transparently to stock nodes if they are unavailable — a
patch always makes sound.

### LFOs and Mod Matrix

Two per-voice LFOs (sine, triangle, sawtooth, square, random) with rate, depth,
delayed onset, key sync, and swing. An LFO only runs when a mod-matrix slot
references it. Destinations cover pitch, amp, filter cutoff/resonance, per-operator
level and frequency, and the three global FX wet mixes — the latter driven by a
free-running LFO pair on the FX bus rather than per voice.

### Voice Management

Three allocation modes. **Poly** gives a voice per note up to a configurable
ceiling, stealing the oldest with a short fade. **Mono** plays one note at a time
and retriggers on each; **legato** retunes the sounding voice instead, so a
phrase played without gaps gets a single attack. Mono and legato keep a held-note
stack with last/low/high priority, so releasing a key falls back to whatever is
still down rather than going silent.

**Glide** is exponential portamento, even in musical pitch rather than in Hz.
**Unison** stacks detuned copies of each note, spread across the stereo field,
with gain scaled by 1/√voices so thickening does not mean getting louder. Each
layer is a real voice and counts against the polyphony ceiling.

Voices are torn down after their longest *enabled* operator release.

### Arpeggiator

A lookahead scheduler built on `AudioContext.currentTime` rather than `setInterval`. The JS tick runs every 25ms and schedules events 80ms ahead, giving stable timing independent of UI frame rate or garbage collection pauses.

- Patterns: up, down, up-down, random
- Hold mode and latch mode
- Rate (0.5–20 Hz), gate (5–99%), octave spread (1–4)
- Notes are pooled — no Web Audio nodes are created or destroyed during playback

### Effects Chain (Global Bus)

All voices feed into a shared effects bus before the master output.

| Effect | Implementation | Key controls |
|---|---|---|
| Reverb | ConvolverNode with algorithmically generated IR | Size, damping, mix |
| Delay | DelayNode with filtered feedback | Time, feedback, mix |
| Chorus | Dual DelayNode with LFO modulation | Rate, depth, mix |
| Distortion | WaveShaperNode, 4× oversample | Drive, tone, mix, mode (soft/hard/bitcrush) |
| EQ | Three BiquadFilterNodes (low shelf, peaking, high shelf) | ±18dB per band, adjustable mid frequency |

Each effect has an independent enable/disable toggle with dry/wet mixing.

### Randomiser

A seeded pseudo-random number generator (mulberry32 algorithm) drives randomisation at three levels:

- **Global** — randomises the entire patch (algorithm, all operators, filter, FX, LFOs)
- **Per-tab** — randomises only the parameters visible in the current tab
- **Per-operator** — individual dice button on each operator panel

Two modes:
- **Safe** — constrained ranges; favours musically useful results (integer-ish ratios, moderate ADSR times, sensible FX levels)
- **Wild** — full parameter ranges; can produce extreme or unusual results

Seeds can be typed manually (any string or number) or generated randomly. The same seed + mode combination always produces the same patch, so interesting results can be saved and shared by seed value alone.

### Input

- **On-screen keyboard** — C3 to E5, touch and mouse, multi-touch polyphonic
- **Computer keyboard** — two-row chromatic layout (z–m for C3 octave, q–p for C4 octave)
- **MIDI** — auto-detected via Web MIDI API; note-on, note-off across all channels

### Presets

Factory presets: Init, Whistle (ported from the original fm-synth-3), E. Piano, Bell, Synth Bass.

User presets are saved to `localStorage`. Patches can be exported as `.cwsyn` JSON files and imported back. The format is self-contained — a `.cwsyn` file holds the complete patch state including all operator params, algorithm, filter, mod matrix slots, LFO settings, FX, and metadata (name, author, tags).

### UI

- Tabbed layout: Operators, Algorithm, Filter, FX, Arp, Presets
- Oscilloscope in the topbar (Web Audio AnalyserNode → canvas)
- Dark/light theme toggle, persisted to localStorage
- Responsive layout — operator grid reflows from 3 columns to 2 on narrow screens
- Knob component supports drag (vertical), mouse wheel, and double-click to type a precise value

---

## Not Yet Implemented

### Operator roles beyond `fm`, `vco` and `noise`
`OperatorParams.role` is defined as `fm | vco | noise | wavetable | pcm`. The
first three are implemented; `wavetable` and `pcm` are in the schema so the patch
format did not need a second breaking change later.

### Route kinds beyond `fm`, `mix` and `sync`
The routing matrix accepts `am` and `ring`, but the engine skips them with a
warning. Ring modulation is needed for the D-50.

### Mod sources beyond the LFOs
`env1`–`env6`, `velocity` and `mod` are typed and shown in the UI as disabled.
Only `lfo1` and `lfo2` are wired.

### Pitch bend / mod wheel
`pitchBend` is in the patch type but never read. MIDI CC messages are not
handled.

### Wavetable editor
`Operator.setWavetable()` performs a DFT and builds a `PeriodicWave`, and
`wavetableData` round-trips through the patch format, but there is no UI to draw
or import a waveform, and the wave selector does not expose the `wavetable`
option.

---

## Planned Build Order

| Phase | Feature | Targets |
|---|---|---|
| 3 | Free envelopes, third LFO, full mod-source coverage, ring mod, ROM wavetables, PCM transients | ESQ-1, D-50 |
| 4 | Pitch bend, mod wheel, aftertouch, wavetable editor | All |

---

## Patch Format (.cwsyn)

A `.cwsyn` file is standard JSON at schema version 2. See
[PATCH_AUTHORING.md](PATCH_AUTHORING.md) for the full field reference and what
each parameter does audibly.

```json
{
  "name": "My Patch",
  "version": 2,
  "algorithm": 5,
  "routes": null,
  "operators": [ /* 6 operator objects, each with an `env` */ ],
  "filter": { /* FilterParams, with an `env` */ },
  "lfo1": { /* LfoParams */ },
  "lfo2": { /* LfoParams */ },
  "modMatrix": [ /* ModSlot[] */ ],
  "fx": { /* FxParams */ },
  "polyphony": 16,
  "glide": 0,
  "unison": { "voices": 1, "detune": 8, "spread": 0.5 },
  "pitchBend": 2,
  "transpose": 0,
  "volume": 0.7
}
```

Partial patches load safely — `normalisePatch()` in `src/engine/PatchMigration.ts`
deep-merges defaults, validates enums, and upgrades v1 files (flat ADSR fields)
to v2 envelopes automatically.

---

## Deployment

The build output (`dist/`) is a static site with no server-side dependencies. Deploy to any static host:

```bash
npm install
npm run build
# Upload dist/ to Netlify, Vercel, GitHub Pages, or any web server
```

Development server with hot reload:

```bash
npm run dev
```

Unit tests:

```bash
npm test
```
