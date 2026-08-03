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
| `role` | `fm` is implemented. `vco`, `noise`, `wavetable`, `pcm` are reserved for later phases and currently behave as `fm`. |
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

`kind` may be `fm`, `am`, `ring`, `sync`, or `mix`. Only `fm` and `mix` are
implemented today; the others are accepted by the schema and skipped with a
warning until the analog phase lands.

---

## Filter

One resonant biquad per voice (12 dB/oct), inserted after the carrier mix.

```json
"filter": {
  "enabled": true, "type": "lowpass", "cutoff": 800, "resonance": 4,
  "envAmount": 0.6, "keytrack": 0.3,
  "env": { "...": "as above" }
}
```

`envAmount` is ±1 and maps to ±4 octaves of cutoff movement, applied as an
additive offset so it stacks with `keytrack` and with any LFO routed to
`filter_cutoff`. `keytrack` of 1.0 makes cutoff follow the keyboard exactly.

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

## Global

| Field | Notes |
|---|---|
| `volume` | `0..1`, applied once at the master output. |
| `polyphony` | Voice ceiling; oldest note is stolen past it. Default 16. |
| `transpose` | Semitones, applied to the played note. |
| `pitchBend` | Stored but not yet read. |
| `glide`, `unison` | Schema-only until the analog phase. |

### FX

Each section has `enabled` and a `mix` acting as a dry/wet crossfade. Reverb
`size` and `damp` regenerate the impulse response when changed, so sweeping them
is momentarily expensive but does now take effect.

Arpeggiator settings are **not** part of the patch — they live in the UI only and
are not saved to `.cwsyn`.

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
