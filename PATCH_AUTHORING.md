# Writing `.cwsyn` patches

A `.cwsyn` file is JSON describing one patch. This document covers the **v2**
schema and, more importantly, what each field actually does in the engine.

Partial patches are safe: `normalisePatch()` (`src/engine/PatchMigration.ts`)
fills every missing field from defaults and upgrades v1 files automatically, so
you can write only the fields you care about. Unknown enum values fall back to
the default rather than breaking the patch.

---

## Signal flow

```
per voice:  operators ──(routing matrix)──> carrier mix ──> filter ──> voice out
global:     voice out ──> EQ ──> Dist ──> Chorus ──> Delay ──> Reverb ──> master
```

A voice is built at note-on from a snapshot of the patch. **Editing a parameter
only affects notes played after the edit** — master volume and the FX chain are
the exceptions, since those are global and update live.

---

## Operators

Six operators. Each is either a **carrier** (reaches the output) or a
**modulator** (frequency-modulates another operator), decided by the algorithm.

```json
{
  "enabled": true,
  "role": "fm",
  "wave": "sine",
  "ratio": 2,
  "fine": 0,
  "fixed": false,
  "fixedFreq": 440,
  "level": 0.5,
  "feedback": 0,
  "env": { "...": "see Envelopes" },
  "karplusStrong": false,
  "ksDecay": 0.995
}
```

| Field | Notes |
|---|---|
| `role` | `fm`, `vco` and `noise` are implemented. `wavetable` and `pcm` are reserved and currently behave as `fm`. |
| `wave` | `sine`, `triangle`, `sawtooth`, `square`, `wavetable`. Non-sine modulators get dense fast — sine is the DX-7 default for a reason. |
| `ratio` | Multiple of the played note. Integers give harmonic timbres; non-integers (1.99, 3.5, 7.13) give inharmonic, bell-like ones. |
| `fine` | ±100 cents. A few cents between two carriers gives slow beating. |
| `fixed` / `fixedFreq` | Fixed operators ignore the played note and run at `fixedFreq` Hz. Correct for drums and formants, wrong for anything melodic. |
| `level` | **Means two different things.** See below. |
| `feedback` | Self-modulation, `0..1`. The only route to a saw-like single-operator timbre. Scaled by the operator's own frequency, so it holds up across the keyboard. |

### `level` is amplitude *or* FM index

For a **carrier**, `level` is linear output amplitude — `0.8` is 80% of full.

For a **modulator**, `level` is the FM index, on a deliberately steep curve
(`levelToIndex()` in `src/engine/Operator.ts`):

| `level` | index | character |
|---|---|---|
| 0.2 | 0.18 | barely audible colouring |
| 0.3 | 0.49 | subtle brightness |
| 0.4 | 1.0  | clearly harmonic |
| 0.5 | 1.8  | rich, still musical |
| 0.6 | 2.8  | bright, edgy |
| 0.7 | 4.1  | aggressive |
| 0.8 | 5.7  | harsh |
| 1.0 | 10.0 | noise-adjacent |

Modulator levels above ~0.6 turn most patches to hash. Start around 0.3–0.5.

Depth is scaled by the modulator's own frequency, so a patch keeps its timbre
across the keyboard instead of getting duller as you play higher.

### Operator roles

| Role | What it is |
|---|---|
| `fm` | Clean band-limited oscillator — the DX-7 operator. Cannot do PWM or sync. |
| `vco` | Analog oscillator (AudioWorklet): PolyBLEP saw/pulse/tri/sine, pulse-width modulation, hard sync, free-running start phase and drift. |
| `noise` | White or pink noise via `noiseType`. Has no frequency, so nothing can modulate its pitch and it cannot be an FM target. |

`vco` operators add three fields:

- **`pulseWidth`** (0.02–0.98) — duty cycle when `wave` is `square`. 0.5 is a
  square; moving it is what gives a Jupiter-8 pad its motion. Route an LFO to it
  for classic PWM.
- **`drift`** (0–1) — slow random pitch wander, up to about 12 cents. A small
  amount (0.2–0.4) stops stacked oscillators sounding like a single digital tone.
- Start phase is randomised per note. `OscillatorNode` always starts at phase 0,
  which is a real part of why the `fm` role sounds more static when layered.

If the worklets have not loaded, `vco` transparently falls back to a stock
oscillator — the patch still sounds, it just loses PWM, sync and drift.

### Karplus-Strong

Setting `karplusStrong: true` replaces the oscillator with a plucked-string
model. It **ignores `ratio`, `fine`, `fixed`/`fixedFreq`, and the entire
envelope** — pitch always tracks the played note. The operator's release still
matters, because the voice fade caps the ring-out. A KS operator has no
oscillator, so it cannot be an FM *target*; routes into it are skipped.

---

## Envelopes

Envelopes are N-stage rate/level. `time` is a stage's duration, `level` is the
value reached at its end.

```json
"env": {
  "stages": [
    { "time": 0.001, "level": 1,   "curve": "lin" },
    { "time": 0.3,   "level": 0.5, "curve": "exp" }
  ],
  "sustainStage": 1,
  "release": [{ "time": 0.3, "level": 0, "curve": "exp" }],
  "velSens": 0.7,
  "keyRateScale": 0,
  "keyLevelScale": 0
}
```

- **`sustainStage`** — the stage held while the key is down. `-1` makes the
  envelope one-shot: every stage runs and the note decays by itself, which is
  what percussion wants.
- **`curve`** — `exp` approaches its target asymptotically and sounds natural on
  decays; `lin` is usually right only for attacks.
- **`velSens`** — `0` ignores velocity entirely (organ-like), `1` makes a soft
  note nearly silent. `0.7` is a good default. On a *modulator* this is what
  makes a patch get brighter when played harder — the single most valuable
  setting for expressive FM.
- **`keyRateScale`** — `1` roughly halves envelope duration per octave up, so
  high notes stop ringing longer than low ones.
- **`keyLevelScale`** — tilts output across the keyboard. Negative values tame
  high modulators, which otherwise turn shrill.

The shape above is the ADSR case, and the operator panel shows A/D/S/R knobs for
it. Add a third stage and set `sustainStage: 2` for a DX-7-style 4-stage
envelope; the panel switches to a rate/level grid automatically.

---

## Routing

`algorithm` is 1–32, using the DX-7 topologies (`src/engine/Algorithms.ts`).
Each algorithm names its carriers and its modulator→target pairs.

Useful starting points:

| Algorithm | Shape | Good for |
|---|---|---|
| 1 | `6→5→4→3→2→1` single chain | Basses, aggressive leads |
| 3 | `(6→5→4)+(3→2→1)` two stacks | Bells, mallets |
| 5 | `(6→5)+(4→3)+(2→1)` three pairs | Most things — the most controllable |
| 16 | all six additive | Organs, drawbar tones |

For custom topologies, set `routes` to an explicit edge list and it overrides
`algorithm`:

```json
"routes": [
  { "from": 1, "to": 0,     "kind": "fm",  "amount": 1 },
  { "from": 0, "to": "out", "kind": "mix", "amount": 1 }
]
```

`kind` may be `fm`, `am`, `ring`, `sync`, or `mix`. `fm`, `mix` and `sync` are
implemented; `am` and `ring` are accepted by the schema and skipped with a
warning until the D-50 phase.

**Hard sync** (`kind: 'sync'`) restarts the target's waveform on every cycle of
the source, so the pitch you hear is the *source's* while the timbre follows the
target's own frequency. Sweeping the target's `ratio` gives the classic sync
sweep. The target must be a `vco` — a stock oscillator's phase is unreachable,
which is exactly why the worklet oscillator exists. Sync routes to any other role
are skipped with a warning.

Note the source of a sync route is usually **not** also routed to the output; see
the `Sync Lead` factory preset.

---

## Filter

One filter per voice, inserted after the carrier mix, in one of three models.

```json
"filter": {
  "enabled": true, "model": "ladder", "type": "lowpass",
  "cutoff": 800, "resonance": 19, "slope": 24, "drive": 0.4,
  "hpfCutoff": 90,
  "envAmount": 0.6, "keytrack": 0.3,
  "env": { "...": "as above" }
}
```

| `model` | Character |
|---|---|
| `biquad` | Stock Web Audio node. Clean and neutral, never self-oscillates. **The default**, so patches written before the analog phase are unchanged. Often the right choice for FM patches. |
| `ladder` | Moog-style 4-pole ladder (AudioWorklet). Self-oscillates at full resonance, loses low end as resonance rises, and saturates when driven. This is the Minimoog/Jupiter-8 sound. |
| `svf` | State-variable (AudioWorklet). Softer and more open — the Oberheim/Prophet flavour, and the right pick for OB-Xa. |

- **`resonance`** is stored on the biquad's 0–30 Q scale for backwards
  compatibility. The analog models normalise it internally, self-oscillating at
  30. The UI shows a percentage when an analog model is selected.
- **`slope`** (12 or 24 dB/oct) applies to the analog models only.
- **`drive`** (0–1) saturates the filter input. Analog models only.
- **`hpfCutoff`** inserts a non-resonant highpass *before* the main filter — the
  Jupiter-8 topology, for thinning the low end of a brass patch. 20 means off.

`envAmount` is ±1 and maps to ±4 octaves of cutoff movement, applied as an
additive offset so it stacks with `keytrack` and with any LFO routed to
`filter_cutoff`. `keytrack` of 1.0 makes cutoff follow the keyboard exactly.

If the worklets have not loaded, `ladder` and `svf` fall back to a biquad.

---

## LFOs and the mod matrix

```json
"lfo1": { "shape": "sine", "rate": 6, "depth": 0.07, "delay": 0.25, "sync": true, "swing": 0 },
"modMatrix": [
  { "source": "lfo1", "dest": "pitch", "amount": 0.3, "enabled": true }
]
```

**An LFO only runs if a mod slot references it**, and effective depth is
`slot.amount × lfo.depth` — both must be non-zero.

Working sources: `lfo1`, `lfo2`. (`env1`–`env6`, `velocity`, `mod` are reserved.)

Destinations: `pitch`, `amp`, `filter_cutoff`, `filter_res`, `opN_level`,
`opN_ratio`, `fx_reverb`, `fx_delay`, `fx_chorus`.

- `pitch` is scaled per operator by its own frequency, so vibrato is a constant
  number of cents rather than detuning operators apart. At `amount × depth` of
  1.0 the swing is about a semitone.
- `fx_*` destinations drive the global FX bus from a free-running LFO, not the
  per-voice ones — otherwise every held note would stack its own modulation into
  the same parameter.

Always include `swing`. Omitting it used to crash note-on; the loader now
defaults it, but writing it keeps the file explicit.

---

## Voice allocation

```json
"voiceMode": "mono",
"notePriority": "low",
"glide": 0.04,
"polyphony": 1,
"unison": { "voices": 3, "detune": 14, "spread": 0.7 }
```

| `voiceMode` | Behaviour |
|---|---|
| `poly` | A voice per note, up to `polyphony`. The default. |
| `mono` | One note at a time; every new note **retriggers** the envelopes. |
| `legato` | One note at a time; overlapping notes **glide without retriggering**, so a phrase played without gaps gets a single attack. Release fully between notes to retrigger. |

**`notePriority`** decides which held key wins in mono and legato: `last`
(default), `low` (the Minimoog behaviour — basslines stay put while you play
above them), or `high`. Releasing a key falls back to whatever is still held
rather than going silent, which is what lets you trill.

**`glide`** is portamento time in seconds. The ramp is exponential, so the slide
is even in musical pitch — a linear ramp from 55 Hz to 880 Hz would spend nearly
all its time in the top octave. Fixed-frequency operators do not glide.

**`unison`** stacks `voices` detuned copies per note:

- `detune` is the total spread in cents, end to end. Odd counts keep one layer
  exactly in tune, so the stack doesn't sound uniformly sharp.
- `spread` pans the layers across the stereo field, widest voices furthest out.
- Each layer is a real voice and **counts against `polyphony`** — a 7-voice
  unison patch at a limit of 16 gives you two notes. Raise `polyphony` to suit.
- Stack gain is scaled by `1/√voices`, so turning unison up thickens the sound
  without making it louder.

Unison layers each get their own oscillator start phase and drift, so they
decorrelate naturally rather than sounding like one detuned tone.

---

## Global

| Field | Notes |
|---|---|
| `volume` | `0..1`, applied once at the master output. |
| `polyphony` | Voice ceiling, counting unison layers. Oldest note is stolen past it. |
| `transpose` | Semitones, applied to the played note. |
| `pitchBend` | Stored but not yet read. |

### FX

Each section has `enabled` and a `mix` acting as a dry/wet crossfade. Reverb
`size` and `damp` regenerate the impulse response when changed, so sweeping them
is momentarily expensive but does now take effect.

Arpeggiator settings are **not** part of the patch — they live in the UI only and
are not saved to `.cwsyn`.

---

## Building a subtractive patch

FM patches use algorithms to stack operators; a subtractive patch wants them all
mixed straight to the filter. That is **algorithm 16** — fully additive, every
operator a carrier. Set the operators to `role: 'vco'`, detune them against each
other with `fine`, and shape with the filter.

The `Minimoog Bass`, `Jupiter Brass`, `Jupiter Pad`, `OB-Xa Pad` and `Sync Lead`
factory presets are all built this way and are the best starting points. Note how
they differ in voice allocation: the Minimoog patches are monophonic with glide
(bass on low-note priority, lead on legato), while the Jupiter and OB-Xa patches
are polyphonic with unison stacking for width.

One trap: a patch that lists fewer than six operators gets the rest filled from
defaults, and **those defaults are enabled**. Always set `"enabled": false`
explicitly on operators you are not using, or they will sound as sine waves
underneath everything.

---

## A worked example

A DX-7-style electric piano: a sine carrier with a high-ratio modulator whose
envelope decays fast, so the metallic tine rings briefly over a clean body.

```json
{
  "name": "E. Piano",
  "version": 2,
  "algorithm": 5,
  "operators": [
    { "enabled": true, "ratio": 1,  "level": 1.0,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 0.8, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.5, "level": 0, "curve": "exp" }],
               "velSens": 0.8, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "ratio": 14, "level": 0.45,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 0.18, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.2, "level": 0, "curve": "exp" }],
               "velSens": 0.9, "keyRateScale": 0, "keyLevelScale": 0 } }
  ],
  "volume": 0.75
}
```

Note the modulator at `level: 0.45` (index ≈ 1.3) with `velSens: 0.9` — that
combination is what makes it bloom when you play harder. The remaining four
operators and every other section are filled from defaults.
