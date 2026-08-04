# cwSynth — Complete Patch Authoring Reference

**Purpose of this document.** This is a self-contained specification of the
cwSynth patch format and synthesis engine, written to be handed to a language
model as context. Everything needed to author a valid, musically sensible
`.cwsyn` patch is here — schema, ranges, defaults, exact numeric mappings,
behavioural quirks, and worked examples. No repository access is required.

**What cwSynth is.** A browser-based synthesiser combining a 6-operator FM
engine (DX-7 lineage) with analog subtractive synthesis (Moog ladder /
Oberheim SVF filters, PolyBLEP oscillators, PWM, hard sync). Patches are JSON.
Schema version 2.

---

## The deliverable: a `.cwsyn` file

A patch is **one JSON object in a plain-text file with a `.cwsyn` extension**.
There is no wrapper, no header, no array — the top level of the file *is* the
patch object shown in §2.

| | |
|---|---|
| **Extension** | `.cwsyn` — the convention, and what the app's export produces. |
| **Format** | Plain UTF-8 JSON. Nothing about the format is special; the extension is just a label. |
| **Also accepted on import** | `.json`. The file picker accepts `.cwsyn,.json`, and the parser only ever does `JSON.parse`. Use `.cwsyn` unless you have a reason not to. |
| **Encoding** | Standard JSON only. **No comments, no trailing commas** — the parser is `JSON.parse`, which rejects both. |
| **Indentation** | Irrelevant to the app. Its own export uses 2-space indent. |
| **Minimum valid file** | `{}` — every field has a default. `{"name":"Tiny"}` imports as a complete 6-operator patch. |

### Filename

The filename carries no meaning to the engine, with one exception noted below.
The app's *export* derives it from the patch's `name` field by replacing runs of
whitespace with underscores:

```
name: "Jump Brass"   →   Jump_Brass.cwsyn
name: "E. Piano"     →   E._Piano.cwsyn
```

Matching that convention when authoring by hand is sensible but not required —
`jump-brass.cwsyn` or `my patch.cwsyn` both import fine.

### The `name` field is what the user actually sees

On import the patch is added to the preset list under its **internal `name`
field**, not its filename. The filename is only used as a fallback when `name`
is missing or empty:

```
name: "Jump Brass"  in  anything.cwsyn   →  listed as "Jump Brass"
name: ""            in  anything.cwsyn   →  listed as "anything"
```

**Always set a meaningful `name`.** A patch with `name: ""` saved as
`patch1.cwsyn` shows up as "patch1".

### How a file gets into the synth

Presets tab → **import .cwsyn** → pick the file. It is validated, migrated if
it is an older schema version, added to the user preset list, and loaded
immediately.

If `JSON.parse` fails the app reports `Invalid .cwsyn file` and nothing is
loaded. If the JSON parses but fields are missing, wrong-typed, or use unknown
enum values, **it will not error** — every such field is silently replaced with
its default. Observed behaviour:

```
{"name":"Tiny"}                     →  imports fine, 6 operators, version 2
{"algorithm":"nonsense"}            →  algorithm 1
{"filter":{"model":"bogus"}}        →  model "biquad"
{"operators":[{"role":"zzz"}]}      →  role "fm"
{"operators":[{"level":"high"}]}    →  level 1.0  (op 1's default)
```

**A patch that imports without complaint is not necessarily the patch you
intended.** A typo in an enum name is indistinguishable from omitting the field.
Check the result against the validation checklist in §14.

---

# 1. The rules that matter most

Read this section before writing anything. Each item silently produces a wrong
patch if ignored.

### 1.1 Unspecified operators default to ENABLED

A patch listing fewer than six operators has the remainder filled from defaults,
and the default operator is **`enabled: true`, sine, ratio 1**. A two-oscillator
patch that omits operators 3–6 will therefore also sound four sine waves at the
fundamental.

**Always write all six operators, setting `"enabled": false` explicitly on
unused ones.**

### 1.2 `level` means two different things

- On a **carrier** (an operator routed to the output): linear output amplitude.
- On a **modulator** (an operator routed into another operator): **FM index**,
  on a steep exponential curve.

The same field, radically different scaling. See §4.2 for the conversion table.
A modulator at `level: 0.8` is not "fairly loud", it is an index of 5.7 —
aggressive and usually too much.

### 1.3 `resonance` is on the biquad scale regardless of model

`resonance` is always written on a **0–30** scale (the biquad's Q). The `ladder`
and `svf` models internally normalise it to 0–1, self-oscillating at 30.

- Want a resonant analog filter? Use **18–26**, not 0.8.
- Want self-oscillation? Use **28–30**.
- `resonance: 1` on a ladder is essentially no resonance at all.

### 1.4 Karplus-Strong ignores most of its operator

`karplusStrong: true` discards `ratio`, `fine`, `fixed`, `fixedFreq`, and the
entire `env`. Pitch always tracks the played note. Only `level`, `ksDecay`, and
the envelope's *release* (indirectly, via voice teardown) still matter.

### 1.5 Parameter edits only affect the next note

A voice snapshots the patch at note-on. Live-updating exceptions are master
`volume` and the whole `fx` section. Everything else takes effect on the next
key press.

### 1.6 Unison layers count against polyphony

`unison.voices: 4` with `polyphony: 16` gives **four notes**, not sixteen. Raise
`polyphony` when raising unison.

---

# 2. Complete patch skeleton

Every field with its default. Any field may be omitted — the loader
(`normalisePatch`) fills it from these defaults, validates enums, and upgrades
version-1 patches. Unknown enum values silently fall back to the default rather
than erroring.

> The next two blocks use `/* … */` to mark elided sections and are therefore
> **not literal JSON**. The worked examples in §13 are complete and valid — copy
> from those.

```jsonc
{
  "name": "Untitled",
  "author": "",
  "tags": [],
  "version": 2,

  "algorithm": 1,
  "routes": null,

  "operators": [ /* exactly 6 — see §4 */ ],

  "filter": {
    "enabled": false,
    "model": "biquad",
    "type": "lowpass",
    "cutoff": 4000,
    "resonance": 1,
    "slope": 24,
    "drive": 0,
    "hpfCutoff": 20,
    "envAmount": 0.5,
    "keytrack": 0.5,
    "env": { /* see §5 */ }
  },

  "lfo1": { "shape": "sine", "rate": 5,   "depth": 0.3, "delay": 0.2, "sync": true,  "swing": 0 },
  "lfo2": { "shape": "sine", "rate": 0.3, "depth": 0.3, "delay": 0.2, "sync": true,  "swing": 0 },
  "modMatrix": [],

  "fx": {
    "reverb": { "enabled": false, "size": 0.6,   "damp": 0.5,      "mix": 0.25 },
    "delay":  { "enabled": false, "time": 0.375, "feedback": 0.4,  "mix": 0.25, "sync": false },
    "chorus": { "enabled": false, "rate": 0.5,   "depth": 0.3,     "mix": 0.4 },
    "dist":   { "enabled": false, "drive": 2,    "tone": 0.5,      "mix": 0.5,  "mode": "soft" },
    "eq":     { "enabled": false, "low": 0, "mid": 0, "high": 0, "midFreq": 1000 }
  },

  "polyphony": 16,
  "voiceMode": "poly",
  "notePriority": "last",
  "glide": 0,
  "unison": { "voices": 1, "detune": 8, "spread": 0.5 },

  "pitchBend": 2,
  "transpose": 0,
  "volume": 0.7
}
```

---

# 3. Signal flow

```
PER VOICE
  operator 1..6 ──(routing matrix: fm / sync / mix)──┐
                                                     ├──> carrier mix
                                                     │
  carrier mix ──> [series HPF] ──> [filter] ──> voice output ──> [pan]
                   (hpfCutoff)     (model)

GLOBAL (shared by all voices)
  voice outputs ──> EQ ──> Distortion ──> Chorus ──> Delay ──> Reverb ──> master volume ──> out
```

- A **carrier** is any operator with a route to `"out"`.
- A **modulator** is any operator routed into another operator.
- One operator can be both.
- The filter is per-voice; the FX chain is global and shared.

---

# 4. Operators

Six operator slots. Full object (again `jsonc` — the `env` is elided):

```jsonc
{
  "enabled": true,
  "role": "fm",
  "wave": "sine",
  "wavetableData": null,
  "ratio": 1,
  "fine": 0,
  "fixed": false,
  "fixedFreq": 440,
  "level": 0.8,
  "feedback": 0,
  "pulseWidth": 0.5,
  "drift": 0,
  "noiseType": "white",
  "karplusStrong": false,
  "ksDecay": 0.995,
  "env": { /* see §5 */ }
}
```

| Field | Type / range | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Disabled operators produce nothing and are skipped by routing. **Set explicitly false on unused slots.** |
| `role` | `fm` \| `vco` \| `noise` \| `wavetable` \| `pcm` | `fm` | Sound source type. `wavetable`/`pcm` are reserved and currently behave as `fm`. |
| `wave` | `sine` \| `triangle` \| `sawtooth` \| `square` \| `wavetable` | `sine` | Waveform. For `vco` role, `square` means a pulse whose duty is `pulseWidth`. |
| `wavetableData` | `number[]` \| null | `null` | 2048 normalised samples, −1..1. Rarely used; no editor exists. |
| `ratio` | 0.5 – 16 | `1` | Pitch as a multiple of the played note. |
| `fine` | −100 – +100 (cents) | `0` | Fine detune. |
| `fixed` | boolean | `false` | When true the operator ignores the played note. |
| `fixedFreq` | 1 – 8000 (Hz) | `440` | Frequency when `fixed` is true. |
| `level` | 0 – 1 | `1.0` (op 1) / `0.8` (ops 2–6) | **Amplitude if carrier, FM index if modulator.** See §4.2. Note the per-slot default differs. |
| `feedback` | 0 – 1 | `0` | Self-modulation depth. |
| `pulseWidth` | 0.02 – 0.98 | `0.5` | Duty cycle. `vco` role only. |
| `drift` | 0 – 1 | `0` | Slow random pitch wander, up to ±12 cents. `vco` role only. |
| `noiseType` | `white` \| `pink` | `white` | `noise` role only. |
| `karplusStrong` | boolean | `false` | Plucked-string model. See §4.4. |
| `ksDecay` | 0.9 – 0.9999 | `0.995` | KS ring-out. Higher = longer. |
| `env` | EnvParams | ADSR(0.001, 0.3, 0.5, 0.3) | Amplitude envelope. See §5. |

## 4.1 Roles

| Role | Source | Capabilities |
|---|---|---|
| `fm` | Stock band-limited oscillator | Clean, cheap. Cannot do PWM or hard sync. The DX-7 operator. |
| `vco` | AudioWorklet PolyBLEP oscillator | Saw / pulse / triangle / sine. Adds **PWM**, **hard sync**, **random start phase**, **drift**. The analog oscillator. |
| `noise` | Looping noise buffer | White or pink. Has no frequency: cannot be pitch-modulated and cannot be an FM or sync *target*. |

Two `vco` behaviours matter musically:

- **Random start phase per note.** `fm` operators always start at phase 0, so
  layered copies are phase-coherent and sound static. `vco` operators do not.
- **Drift.** 0.2–0.4 is enough to stop a stack sounding like one digital tone.

If the audio worklets fail to load, `vco` falls back to a stock oscillator
transparently — the patch still sounds, but loses PWM, sync and drift.

## 4.2 `level` → FM index (modulators only)

Formula: `index = 10 × level^2.5`

| `level` | Index | Character |
|---|---|---|
| 0.1 | 0.03 | inaudible |
| 0.2 | 0.18 | faint colouring |
| 0.3 | 0.49 | subtle brightness |
| 0.4 | 1.01 | clearly harmonic |
| 0.5 | 1.77 | rich, musical |
| 0.6 | 2.79 | bright, edgy |
| 0.7 | 4.10 | aggressive |
| 0.8 | 5.72 | harsh |
| 0.9 | 7.68 | very harsh |
| 1.0 | 10.0 | noise-adjacent |

**Practical range for modulators: 0.25 – 0.55.** Above ~0.6 most patches become
noise. Carriers use `level` as plain amplitude and typically sit at 0.7 – 1.0.

Modulation depth in Hz is `index × the modulator's own frequency`, so timbre
stays constant across the keyboard rather than dulling as you play higher.

## 4.3 Feedback

Self-modulation, scaled by the operator's own frequency (max index 2.5 at
`feedback: 1.0`). It is the only way to get a bright, saw-like timbre from a
single sine operator. Useful range 0.05 – 0.3; above ~0.5 it turns to noise.

## 4.4 Karplus-Strong

Replaces the oscillator with a plucked-string physical model.

- **Ignores** `ratio`, `fine`, `fixed`, `fixedFreq`, and the entire `env`.
- Pitch always tracks the played note.
- Cannot be an FM or sync target (no oscillator to modulate) — such routes are
  silently skipped.
- `ksDecay` controls ring-out; the voice's release still caps it.

---

# 5. Envelopes

N-stage rate/level. `time` is a stage's **duration**; `level` is the value
reached at the **end** of that stage.

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

| Field | Range | Meaning |
|---|---|---|
| `stages` | array | Key-down stages, run in order. |
| `sustainStage` | integer, or −1 | Index of the stage held while the key is down. **−1 = one-shot**: every stage runs and the note decays by itself (percussion). |
| `release` | array | Stages run after key-up. |
| `velSens` | 0 – 1 | Velocity → output scaling. 0 = ignores velocity entirely (organ). 1 = a soft note is nearly silent. |
| `keyRateScale` | 0 – 1 | Higher notes run faster. 1.0 ≈ halves duration per octave above middle C. |
| `keyLevelScale` | −1 – +1 | Tilts level across the keyboard. Negative tames shrill high notes. |
| `curve` | `lin` \| `exp` | `exp` approaches asymptotically and sounds natural on decays. `lin` suits attacks. |

**The ADSR shape** is the 2-stage form shown above:
`stages: [{A, 1, lin}, {D, S, exp}], sustainStage: 1, release: [{R, 0, exp}]`.

**The DX-7 4-stage shape** is three key-down stages with `sustainStage: 2`, plus
one release stage.

**`velSens` on a modulator** is the single most expressive setting in FM: it is
what makes a patch get brighter when played harder. 0.7–0.9 for expressive
patches, 0 for organ-like consistency.

---

# 6. Routing

## 6.1 Algorithms

Set `algorithm` to 1–32 and leave `routes: null`. Operator numbering in the
labels below is 1-based (OP1…OP6); indices in `routes` are 0-based.

| # | Topology | Carriers | Good for |
|---|---|---|---|
| 1 | 6→5→4→3→2→1 | 1 | Basses, aggressive leads |
| 2 | (6→5)4→3→2→1 | 1 | As 1 |
| 3 | (6→5→4)+(3→2→1) | 1, 4 | Bells, mallets, dual-stack |
| 4 | (6→5→4→3)+2→1 | 1, 4 | Deep stack + second voice |
| 5 | (6→5)+(4→3)+(2→1) | 1, 3, 5 | **Most controllable. Default choice.** |
| 6 | (6+5+4+3)→2→1 | 1 | Dense modulation into one chain |
| 7 | (6+5+4)→3+2→1 | 1, 3 | Complex + simple layer |
| 8 | (6+5)→4+3+2→1 | 1, 3, 4 | Three-way |
| 9 | (6→5→4)+(3+2)→1 | 1 | Multi-modulator into one carrier |
| 10 | (6→5+4+3+2)→1 | 1 | Four modulators, one carrier |
| 11 | (6+5+4+3+2)→1 | 1 | Five modulators, one carrier |
| 12 | 6→(5+4+3+2+1) | 1–5 | One modulator across five carriers |
| 13 | (6→5)+(4→3)+2+1 | 1, 2, 3, 5 | Two pairs + two pure |
| 14 | (6→5→4)+3+2+1 | 1–4 | One stack + three pure |
| 15 | (6→5)+4+3+2+1 | 1–5 | One pair + four pure |
| 16 | **1+2+3+4+5+6 (additive)** | 1–6 | **Organs, and all subtractive/analog patches** |
| 17 | 6→5+4+3+2+1 | 1–5 | As 15 |
| 18 | (6→5→4)+3+2+1 v2 | 1–4 | Variant of 14 |
| 19 | ((6+5)→4→3)+(2→1) | 1, 3 | Dual stack |
| 20 | (6→5→4→3)+(2+1) | 1, 2 | Stack + pair |
| 21 | (6→5→4)+(3→2→1) v2 | 1, 4 | Variant of 3 |
| 22 | 6+5→4→3→2→1 | 1 | Chain with extra modulator |
| 23 | 6→5+4+3+(2→1) | 1, 3, 4, 5 | Mixed |
| 24 | (6→5→4)+3+2+1 v3 | 1–4 | Variant of 14 |
| 25 | (6+5→4+3)+(2→1) | 1, 3, 4 | Mixed |
| 26 | (6→5+4→3)+2+1 | 1, 2, 3 | Mixed |
| 27 | (6→5→4+3→2→1) | 1 | Deep branching chain |
| 28 | 6fb→5→4→3→2→1 | 1 | Chain (use OP6 `feedback`) |
| 29 | (6→5)+(4+3→2→1) | 1, 5 | Two groups |
| 30 | (6+5+4→3→2→1) | 1 | Three modulators into a chain |
| 31 | (6→5→4→3)+(2→1) | 1, 3 | Stack + pair |
| 32 | (6→5→4→3+2→1) | 1 | Branching chain |

**For any subtractive/analog patch, use algorithm 16.** All six operators become
carriers mixed straight to the filter — which is exactly what an analog synth's
oscillator mixer is.

## 6.2 Custom routes

Setting `routes` to a non-null array **overrides `algorithm` entirely**.

```json
"routes": [
  { "from": 1, "to": 0,     "kind": "fm",  "amount": 1 },
  { "from": 0, "to": "out", "kind": "mix", "amount": 1 }
]
```

- `from` / `to`: operator index **0-based** (0 = OP1). `to` may be `"out"`.
- `amount`: 0–1 multiplier applied on top of the source operator's `level`.
- `kind`:

| Kind | Status | Effect |
|---|---|---|
| `mix` | implemented | Source reaches the voice output. Makes it a carrier. |
| `fm` | implemented | Source frequency-modulates the target. |
| `sync` | implemented | Source hard-syncs the target. Target **must** be `role: "vco"`. |
| `am` | **not implemented** | Accepted by the schema, skipped with a warning. |
| `ring` | **not implemented** | Accepted by the schema, skipped with a warning. |

**An operator with no route is silent**, even if `enabled: true`. When using
custom `routes`, every operator you want heard needs a `"mix"` route.

## 6.3 Hard sync

The source restarts the target's waveform every cycle, so the **pitch you hear
is the source's** while the **timbre follows the target's** frequency. Sweeping
the target's `ratio` gives the classic sync sweep.

- Target must be `role: "vco"`. Sync into `fm`, `noise` or KS is skipped.
- The sync source is usually **not** routed to `"out"` — you hear the synced
  oscillator, not the master.

---

# 7. Filter

One filter per voice, after the carrier mix.

```json
"filter": {
  "enabled": true,
  "model": "ladder",
  "type": "lowpass",
  "cutoff": 800,
  "resonance": 19,
  "slope": 24,
  "drive": 0.4,
  "hpfCutoff": 20,
  "envAmount": 0.55,
  "keytrack": 0.35,
  "env": { /* ADSR-shaped */ }
}
```

| Field | Range | Notes |
|---|---|---|
| `model` | `biquad` \| `ladder` \| `svf` | See below. Default `biquad`. |
| `type` | `lowpass` \| `highpass` \| `bandpass` \| `notch` | |
| `cutoff` | 20 – 20000 Hz | |
| `resonance` | **0 – 30** | Always this scale. See §1.3. |
| `slope` | 12 \| 24 (dB/oct) | `ladder`/`svf` only. |
| `drive` | 0 – 1 | Input saturation. `ladder`/`svf` only. |
| `hpfCutoff` | 20 – 2000 Hz | Series non-resonant highpass **before** the main filter. **20 = off.** |
| `envAmount` | −1 – +1 | Envelope depth, ±4 octaves of cutoff. |
| `keytrack` | 0 – 1 | 1.0 = cutoff follows the keyboard exactly. |

## 7.1 Models

| Model | Character | Use for |
|---|---|---|
| `biquad` | Stock Web Audio. Clean, neutral, **never self-oscillates**. | FM patches; anything wanting transparency. **Default.** |
| `ladder` | Moog 4-pole. Self-oscillates, loses low end as resonance rises, saturates when driven. | Minimoog, Jupiter-8, anything needing squelch. |
| `svf` | State-variable. Softer, more open. | Oberheim/Prophet character, OB-Xa, pads. |

## 7.2 Filter envelope maths

```
baseCutoff = cutoff × 2^(keytrack × (semitone − 60) / 12)
envRange   = baseCutoff × (2^(envAmount × 4) − 1)
peak       = baseCutoff + envRange
sustain    = baseCutoff + envRange × (env sustain level)
```

| `envAmount` | Peak cutoff multiplier |
|---|---|
| 0.25 | ×2 |
| 0.5 | ×4 |
| 0.75 | ×8 |
| 1.0 | ×16 |
| −0.5 | ×0.25 (inverted sweep) |

**The single most common patch-authoring mistake:** setting `cutoff` high and
`envAmount` low. The filter then sits above the harmonic energy in both the
attack and the sustain, and the envelope does nothing audible. For a brass-like
attack, put `cutoff` **below** the bulk of the harmonics (600–1200 Hz for a
mid-register patch) and use `envAmount` 0.45–0.6 so the sweep passes *through*
them.

---

# 8. LFOs and the mod matrix

```json
"lfo1": { "shape": "triangle", "rate": 0.6, "depth": 0.5, "delay": 0, "sync": false, "swing": 0 },
"modMatrix": [
  { "source": "lfo1", "dest": "filter_cutoff", "amount": 0.25, "enabled": true }
]
```

| LFO field | Range | Notes |
|---|---|---|
| `shape` | `sine` \| `triangle` \| `sawtooth` \| `square` \| `random` | |
| `rate` | 0.01 – 20 Hz | |
| `depth` | 0 – 1 | Multiplies every slot using this LFO. |
| `delay` | 0 – 4 s | Fade-in before the LFO takes effect. |
| `sync` | boolean | Restart on note-on. |
| `swing` | 0 – 1 | Uneven half-cycles. |

**An LFO only runs if a mod-matrix slot references it.** Effective depth is
`slot.amount × lfo.depth` — both must be non-zero.

**Sources:** only `lfo1` and `lfo2` are implemented. `env1`–`env6`, `velocity`
and `mod` are reserved and produce nothing.

**Destinations and their scaling:**

| `dest` | Swing at `amount × depth` = 1.0 |
|---|---|
| `pitch` | ±6% of frequency ≈ **±1 semitone**. Applied per operator against its own frequency, so operators stay in tune with each other. |
| `op1_ratio` … `op6_ratio` | ±6% of that operator's frequency. |
| `op1_level` … `op6_level` | ±100% of that operator's nominal route gain. |
| `filter_cutoff` | ±`filter.cutoff` Hz. |
| `filter_res` | ±full resonance range for the active model. |
| `amp` | ±0.5 of voice output gain. |
| `fx_reverb`, `fx_delay`, `fx_chorus` | ±0.5 of wet mix. Driven by a **free-running global LFO**, not per-voice. |

For vibrato, `amount × depth` around 0.05–0.15 is musical; 1.0 is a full
semitone and sounds seasick.

**Always include `swing`.** It defaults safely now, but older patches that
omitted it used to crash note-on.

---

# 9. Voice allocation

```json
"voiceMode": "mono",
"notePriority": "low",
"glide": 0.04,
"polyphony": 1,
"unison": { "voices": 3, "detune": 14, "spread": 0.7 }
```

| `voiceMode` | Behaviour |
|---|---|
| `poly` | A voice per note, up to `polyphony`. Oldest stolen past the limit. **Default.** |
| `mono` | One note at a time; every new note **retriggers** the envelopes. |
| `legato` | One note at a time; overlapping notes **glide without retriggering**, so a phrase played without gaps gets a single attack. Release fully between notes to retrigger. |

**`notePriority`** (mono/legato only): `last` (default), `low` (the Minimoog
behaviour — basslines hold while you play above them), `high`. Releasing a key
falls back to whatever is still held rather than going silent.

**`glide`** — portamento in seconds. Exponential, so the slide is even in
musical pitch. Fixed-frequency operators do not glide. 0.02–0.08 is a subtle
lift; 0.2+ is an obvious swoop.

**`unison`**:

- `voices` (1–8): copies per note. 1 = off.
- `detune` (cents): **total spread end to end**. Layer *i* of *n* is offset by
  `(i/(n−1) − 0.5) × detune`. Odd counts keep one layer exactly in tune.
- `spread` (0–1): stereo width; layers pan from `−spread` to `+spread`.
- Stack gain is scaled by `1/√voices`, so unison thickens without getting louder.
- **Each layer counts against `polyphony`.**

Typical: 2 voices / 8–12 cents for subtle width; 3 voices / 14–18 cents for the
Oberheim signature; 5+ for supersaw territory.

---

# 10. Effects (global)

Every section has `enabled` and a `mix` acting as a dry/wet crossfade.

| Effect | Fields | Notes |
|---|---|---|
| `reverb` | `size` 0–1, `damp` 0–1, `mix` 0–1 | Changing `size`/`damp` regenerates the impulse response. |
| `delay` | `time` 0.05–2 s, `feedback` 0–0.95, `mix` 0–1, `sync` | `sync` is stored but **not implemented**. |
| `chorus` | `rate` 0.05–8 Hz, `depth` 0–1, `mix` 0–1 | Adds movement; the width in a patch comes mainly from unison `spread`. |
| `dist` | `drive` 0–10, `tone` 0–1, `mix` 0–1, `mode` `soft`\|`hard`\|`bit` | |
| `eq` | `low`/`mid`/`high` −18–+18 dB, `midFreq` 200–8000 Hz | Low shelf / peaking / high shelf. |

Chain order is fixed: **EQ → Distortion → Chorus → Delay → Reverb**.

---

# 11. Global fields

| Field | Range | Notes |
|---|---|---|
| `volume` | 0 – 1 | Applied once at the master output. |
| `transpose` | semitones | Applied to the played note. |
| `polyphony` | 1 – 32 | Voice ceiling, counting unison layers. |
| `pitchBend` | semitones | **Stored but never read.** No MIDI CC handling exists. |
| `name`, `author`, `tags` | strings | Metadata. |
| `version` | 2 | Always 2 for new patches. |

**Arpeggiator settings are not part of the patch.** They live in the UI only.

---

# 12. Recipes by instrument family

### FM (DX-7 family)
- `algorithm` 5 (controllable) or 3 (bells), `role: "fm"`, sine waves.
- Carriers `level` 0.8–1.0; modulators `level` 0.3–0.5.
- Integer `ratio` → harmonic; non-integer (1.99, 3.5, 7.13) → bell-like.
- Fast-decaying modulator envelope over a slower carrier = struck/plucked.
- `velSens` 0.8–0.9 on modulators for dynamic brightness.
- Filter usually `biquad` or disabled.

### Analog subtractive (Minimoog, Jupiter-8, OB-Xa)
- `algorithm` **16**, `role: "vco"`, `wave: "sawtooth"` or `"square"`.
- Two or three oscillators detuned with `fine` (±5 to ±15 cents).
- `drift` 0.25–0.4.
- Filter `ladder` (Moog/Roland) or `svf` (Oberheim), `resonance` 7–22.
- `cutoff` low enough that `envAmount` 0.4–0.6 sweeps through the harmonics.

### Minimoog specifically
- `voiceMode: "mono"`, `notePriority: "low"`, `polyphony: 1`, `glide` 0.03–0.08.
- `model: "ladder"`, `slope: 24`, high `resonance` (18–22), `drive` 0.3–0.5.
- Three oscillators, one an octave down (`ratio: 0.5`) for weight.

### Jupiter-8
- `model: "ladder"`, `slope: 24`, moderate resonance (8–12).
- `hpfCutoff` 60–120 — the series highpass is part of the JP-8 topology.
- Pulse waves with slow LFO → `pulseWidth` for PWM movement.
- Chorus on.

### OB-Xa
- `model: "svf"`, `slope: 12`, resonance 9–14.
- Heavy detuning: `fine` ±14–16, `unison` 3 voices / 16 cents / spread 0.85.

### Percussion
- `fixed: true` with `fixedFreq` for drums (pitch shouldn't track the keyboard).
- `sustainStage: -1` for one-shot envelopes.
- `role: "noise"` for snares and hats.
- `karplusStrong: true` for plucks and metallic hits.

---

# 13. Worked examples

All three are complete, valid JSON and have been rendered through the engine to
confirm they load and produce sound. Copy from these rather than from the
annotated skeletons in §2 and §4.

## 13.1 FM electric piano

The classic tine: a high-ratio modulator with a fast-decaying envelope over a
clean sine body. Algorithm 5 gives two independent carrier/modulator pairs.

```json
{
  "name": "E. Piano",
  "version": 2,
  "algorithm": 5,
  "operators": [
    { "enabled": true, "role": "fm", "wave": "sine", "ratio": 1, "level": 1.0,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 0.8, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.5, "level": 0, "curve": "exp" }],
               "velSens": 0.8, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "role": "fm", "wave": "sine", "ratio": 14, "level": 0.45,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 0.18, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.2, "level": 0, "curve": "exp" }],
               "velSens": 0.9, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "role": "fm", "wave": "sine", "ratio": 1, "level": 0.55,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 1.2, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.6, "level": 0, "curve": "exp" }],
               "velSens": 0.8, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "role": "fm", "wave": "sine", "ratio": 7, "level": 0.3,
      "env": { "stages": [{ "time": 0.001, "level": 1, "curve": "lin" },
                          { "time": 0.3, "level": 0, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.2, "level": 0, "curve": "exp" }],
               "velSens": 0.9, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": false },
    { "enabled": false }
  ],
  "filter": { "enabled": false },
  "fx": {
    "reverb": { "enabled": true, "size": 0.5, "damp": 0.5, "mix": 0.2 },
    "chorus": { "enabled": true, "rate": 0.4, "depth": 0.2, "mix": 0.3 }
  },
  "volume": 0.75
}
```

Key points: modulator at `0.45` (index 1.3) not `0.8`; `velSens 0.9` on the
modulators is what makes it bloom when played hard; operators 5 and 6 explicitly
disabled.

## 13.2 Analog mono bass

```json
{
  "name": "Mono Bass",
  "version": 2,
  "algorithm": 16,
  "operators": [
    { "enabled": true, "role": "vco", "wave": "sawtooth", "ratio": 1, "level": 0.9, "drift": 0.25,
      "env": { "stages": [{ "time": 0.002, "level": 1, "curve": "lin" },
                          { "time": 0.4, "level": 0.7, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.15, "level": 0, "curve": "exp" }],
               "velSens": 0.5, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "role": "vco", "wave": "sawtooth", "ratio": 1, "fine": -7, "level": 0.8, "drift": 0.25,
      "env": { "stages": [{ "time": 0.002, "level": 1, "curve": "lin" },
                          { "time": 0.4, "level": 0.7, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.15, "level": 0, "curve": "exp" }],
               "velSens": 0.5, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": true, "role": "vco", "wave": "square", "ratio": 0.5, "pulseWidth": 0.5, "level": 0.7, "drift": 0.25,
      "env": { "stages": [{ "time": 0.002, "level": 1, "curve": "lin" },
                          { "time": 0.4, "level": 0.7, "curve": "exp" }],
               "sustainStage": 1,
               "release": [{ "time": 0.15, "level": 0, "curve": "exp" }],
               "velSens": 0.5, "keyRateScale": 0, "keyLevelScale": 0 } },
    { "enabled": false }, { "enabled": false }, { "enabled": false }
  ],
  "filter": {
    "enabled": true, "model": "ladder", "type": "lowpass", "slope": 24,
    "cutoff": 260, "resonance": 19, "drive": 0.45,
    "envAmount": 0.55, "keytrack": 0.35,
    "env": { "stages": [{ "time": 0.002, "level": 1, "curve": "lin" },
                        { "time": 0.22, "level": 0.12, "curve": "exp" }],
             "sustainStage": 1,
             "release": [{ "time": 0.2, "level": 0, "curve": "exp" }],
             "velSens": 0, "keyRateScale": 0, "keyLevelScale": 0 }
  },
  "voiceMode": "mono",
  "notePriority": "low",
  "glide": 0.04,
  "polyphony": 1,
  "volume": 0.75
}
```

Key points: `resonance: 19` (not 0.6 — see §1.3); `cutoff: 260` is low so the
envelope's ×4.6 sweep does audible work; `ratio: 0.5` sub-oscillator for weight.

## 13.3 Hard-sync lead

```json
{
  "name": "Sync Lead",
  "version": 2,
  "algorithm": 16,
  "routes": [
    { "from": 0, "to": 1,     "kind": "sync", "amount": 1 },
    { "from": 1, "to": "out", "kind": "mix",  "amount": 1 }
  ],
  "operators": [
    { "enabled": true, "role": "vco", "wave": "sawtooth", "ratio": 1,   "level": 0.9 },
    { "enabled": true, "role": "vco", "wave": "sawtooth", "ratio": 2.8, "level": 0.9 },
    { "enabled": false }, { "enabled": false }, { "enabled": false }, { "enabled": false }
  ],
  "filter": { "enabled": true, "model": "ladder", "type": "lowpass",
              "cutoff": 3500, "resonance": 6, "drive": 0.3 },
  "voiceMode": "legato",
  "glide": 0.06,
  "polyphony": 1,
  "volume": 0.65
}
```

Key points: OP1 is the sync master and is **not** routed to `"out"` — you hear
OP2. OP2's `ratio` controls timbre, not pitch; sweep it for the sync sound.

---

# 14. Validation checklist

Before returning a patch, verify:

1. **Exactly six operators**, with unused ones `"enabled": false`.
2. **Modulator `level` ≤ ~0.55** unless deliberately harsh (§4.2).
3. **`resonance` on the 0–30 scale** — 18+ for a resonant analog filter (§1.3).
4. **Filter `cutoff` below the harmonics** if the envelope is meant to be heard
   (§7.2).
5. **Analog patches use `algorithm: 16`** and `role: "vco"`.
6. **Every LFO object includes `swing`.**
7. **Mod-matrix slots reference only `lfo1`/`lfo2`**, with both `amount` and the
   LFO's `depth` non-zero.
8. **`polyphony` ≥ chord size × `unison.voices`.**
9. **Custom `routes` give every audible operator a `"mix"` route**, and any
   `sync` target is `role: "vco"`.
10. **KS operators** don't rely on `ratio`, `fine`, `fixed` or `env` (§4.4).

---

# 15. Reference: factory presets

Useful as starting points and as style references.

| ID | Name | Character |
|---|---|---|
| `init` | Init | Bare default patch |
| `whistle` | Whistle | Near-pure sine, LFO vibrato |
| `ep` | E. Piano | DX-7 tine electric piano |
| `bell` | Bell | Inharmonic FM bell, long decay |
| `bass` | Synth Bass | FM bass with filter and distortion |
| `minimoog-bass` | Minimoog Bass | Mono, low priority, ladder, glide |
| `minimoog-lead` | Minimoog Lead | Legato, ladder, vibrato |
| `jp8-brass` | Jupiter Brass | Ladder + series HPF, PWM, unison |
| `jp8-pad` | Jupiter Pad | SVF, slow PWM, chorus |
| `obxa-pad` | OB-Xa Pad | SVF 2-pole, wide unison |
| `jump-brass` | Jump Brass | OB-Xa stacked brass, bright, fast filter attack |
| `sync-lead` | Sync Lead | Hard sync, legato |

---

# 16. Known limitations

Do not author patches that depend on these:

- `pitchBend` is stored but never read; no MIDI CC handling.
- `delay.sync` is stored but not implemented.
- Mod sources `env1`–`env6`, `velocity`, `mod` are reserved and inert.
- Route kinds `am` and `ring` are accepted but skipped.
- Operator roles `wavetable` and `pcm` behave as `fm`.
- No wavetable editor; `wavetableData` must be supplied as raw samples.
- Arpeggiator settings are not saved in the patch.
- Presets generally run hot — a four-note chord can peak above 1.0 and clip.
  Keep `volume` ≤ 0.75 for dense polyphonic patches.
