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
    AudioEngine.ts      — voice lifecycle, note-on/off, context management
    Voice.ts            — 6-operator FM voice with algorithm routing
    Operator.ts         — single operator: oscillator, ADSR, feedback, Karplus-Strong
    Algorithms.ts       — 32 DX7-style algorithm topology definitions
    Arpeggiator.ts      — lookahead scheduler with voice pooling
    Randomiser.ts       — seeded PRNG, constrained + wild parameter ranges
    Types.ts            — full TypeScript interfaces for all patch data
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
- Frequency ratio (0.5–16×) and fine detune (±100 cents)
- ADSR envelope controlling amplitude
- Self-feedback loop (operator modulating its own frequency)
- Per-operator enable/disable

**32 algorithms** — the full DX7 topology set. Each algorithm defines which operators are carriers (routed to audio output) and which are modulators (routed to another operator's frequency input). Algorithms are defined as data in `Algorithms.ts` and the routing is built dynamically in `Voice.ts` on each note-on.

**Karplus-Strong physical modelling** — any operator can be switched to KS mode, replacing its oscillator with a noise burst fed into a delay/filter feedback loop. Produces plucked string and percussion timbres. Decay rate is adjustable.

**Voice management** — voices are created on note-on and disposed after their release phase completes. The AudioContext is lazily initialised on the first user gesture to comply with browser autoplay policy.

### Resonant Filter

Per-voice filter inserted between the FM carrier mix and the output. Supports lowpass, highpass, bandpass, and notch modes. Parameters:

- Cutoff frequency (20Hz–20kHz)
- Resonance / Q (0.1–30)
- Dedicated ADSR envelope with adjustable depth (−1 to +1, scales ±4 octaves)
- Key tracking (0–100%, scales cutoff with MIDI note)

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

These features are designed and typed but not yet wired up:

### LFOs
`LfoParams` is defined in `Types.ts` and `lfo1`/`lfo2` fields exist on every patch, but no LFO oscillators exist in the engine. No modulation is applied at runtime. **This is the next build priority.**

### Mod Matrix
`ModSlot`, `ModSource`, and `ModDest` types are fully defined in `Types.ts`. The patch format includes a `modMatrix` array. No UI panel exists and the engine does not read or apply mod matrix entries. **Depends on LFOs being implemented first.**

### Velocity Sensitivity
The keyboard fires notes with a hardcoded velocity of 0.8. The engine's `noteOn` method accepts velocity and passes it to operators, but the keyboard component does not derive variable values from touch area, mouse speed, or MIDI velocity.

### Pitch Bend / Mod Wheel
`pitchBend` range is in the patch type. MIDI CC messages (pitch bend, mod wheel) are not handled. No UI control exists.

### Transpose
`transpose` (semitones) is in the patch type but is not applied in `AudioEngine._noteOn()`. One-line fix.

### Fixed-Frequency Operator Mode
The `fixed` and `fixedFreq` fields exist in `OperatorParams` and `Operator.ts` reads them correctly. The operator panel UI only shows ratio/fine controls — there is no toggle to switch an operator into fixed-frequency mode.

### Wavetable Editor
`wavetableData` (normalised float array, 2048 samples) is in `OperatorParams`. `Operator.ts` has a working `setWavetable()` method that performs a DFT and builds a `PeriodicWave`. No UI exists to draw a waveform in the browser or import a WAV file. The wave type selector in the operator panel does not expose the `wavetable` option yet.

### Voice Stealing
There is no polyphony limit. Holding many notes simultaneously creates a voice per note with no ceiling. A standard voice-stealing algorithm (steal oldest, steal quietest) should be added with a configurable polyphony limit.

---

## Planned Build Order

| Priority | Feature | Notes |
|---|---|---|
| 1 | LFOs — engine + UI | Real LFO oscillators, rate/depth/shape/delay controls, per-patch lfo1 + lfo2 |
| 2 | Mod matrix — engine + UI | Sources: LFO1, LFO2, ENV1–6, velocity, mod wheel. Destinations: op levels, ratios, filter cutoff, filter res, pitch, amp, FX mix |
| 3 | Velocity sensitivity | Variable velocity from keyboard touch area/speed and MIDI |
| 4 | Pitch bend / mod wheel | MIDI CC handling, on-screen pitch bend strip |
| 5 | Transpose control | Semitone offset in topbar or global settings panel |
| 6 | Fixed-frequency operator mode | Toggle per operator, Hz input replacing ratio |
| 7 | Wavetable editor | Draw waveform in canvas, import WAV, FFT → PeriodicWave |
| 8 | Voice stealing / polyphony limit | Configurable limit, steal-oldest algorithm |

---

## Patch Format (.cwsyn)

A `.cwsyn` file is standard JSON. Example minimal structure:

```json
{
  "name": "My Patch",
  "author": "CW Synth",
  "tags": ["bass", "dark"],
  "version": 1,
  "algorithm": 5,
  "operators": [ /* 6 operator objects */ ],
  "filter": { /* FilterParams */ },
  "lfo1": { /* LfoParams */ },
  "lfo2": { /* LfoParams */ },
  "modMatrix": [ /* ModSlot[] */ ],
  "fx": { /* FxParams */ },
  "pitchBend": 2,
  "transpose": 0,
  "volume": 0.7
}
```

All fields have typed defaults in `Types.ts` so partial patches load safely — missing fields fall back to `DEFAULT_PATCH` values.

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
