import { Operator, levelToIndex } from './Operator';
import { expandAlgorithm } from './Algorithms';
import type { PatchParams, ModDest, Route } from './Types';
import { scheduleEnvelope, scheduleRelease, releaseDuration } from './Envelope';
import { VoiceFilter } from './VoiceFilter';
import { Lfo } from './Lfo';
import { logger } from '../debug/Logger';

/** An AudioParam plus how far a unit modulator should swing it. */
interface ModTarget { param: AudioParam; scale: number }

/** Cutoff envelope depth: envAmount 1.0 opens the filter by four octaves. */
const FILTER_ENV_OCTAVES = 4;

export interface VoiceOptions {
  /** Stereo position, -1..1. Only creates a panner when non-zero. */
  pan?: number;
  /** Pitch to glide from on note-on, in Hz. Omit to start at pitch. */
  glideFromHz?: number;
  /** Portamento time in seconds. */
  glideTime?: number;
}

export class Voice {
  private ctx: AudioContext;
  public output: GainNode;
  /** Last node in the voice chain — the panner when there is one. */
  public outlet: AudioNode;
  private panner: StereoPannerNode | null = null;
  private operators: Operator[];
  private carrierMix: GainNode;
  private filter: VoiceFilter;
  private filterEnvSource: ConstantSourceNode;
  private filterEnvGain: GainNode;
  public semitone: number;
  public noteHz: number;
  private patch: PatchParams;
  private routes: Route[];
  private lfoA: Lfo;
  private lfoB: Lfo;

  /** Gain stages built at noteOn — amplitude for carriers, FM index for modulators. */
  private routeGains: GainNode[] = [];
  /**
   * Outgoing route gains per source operator, so opN_level can modulate them.
   *
   * The nominal value is stored rather than read back from the AudioParam:
   * `setValueAtTime` schedules a value but leaves `.value` reporting the node's
   * default until the scheduler runs, so reading it here returned 1.0 and made
   * opN_level modulation depth wrong by a factor of 1/level — 13x too much on a
   * quiet operator.
   */
  private gainsBySource: { gain: GainNode; nominal: number }[][] =
    Array.from({ length: 6 }, () => []);
  private opts: VoiceOptions;
  private velocity = 1;
  private _noteOffTime = 0;
  private _endTime = Infinity;

  constructor(
    ctx: AudioContext,
    patch: PatchParams,
    semitone: number,
    hz: number,
    opts: VoiceOptions = {},
  ) {
    this.opts = opts;
    this.ctx = ctx;
    this.patch = patch;
    this.semitone = semitone;
    this.noteHz = hz;

    this.routes = patch.routes ?? expandAlgorithm(patch.algorithm);

    // Master volume lives on AudioEngine.masterGain only — applying it here too
    // would square it.
    this.output = ctx.createGain();
    this.output.gain.value = 1;

    // Unison spread pans each stacked voice across the stereo field. Only build
    // the panner when it would do something — most patches are a single voice.
    if (opts.pan) {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      this.output.connect(this.panner);
      this.outlet = this.panner;
    } else {
      this.outlet = this.output;
    }

    this.carrierMix = ctx.createGain();
    this.carrierMix.gain.value = 1;

    this.filter = new VoiceFilter(ctx, patch.filter);

    // Filter envelope as an additive offset on cutoff, so it composes with both
    // key tracking and any LFO routed to filter_cutoff.
    this.filterEnvSource = ctx.createConstantSource();
    this.filterEnvSource.offset.value = 1;
    this.filterEnvGain = ctx.createGain();
    this.filterEnvGain.gain.value = 0;
    this.filterEnvSource.connect(this.filterEnvGain);
    this.filterEnvGain.connect(this.filter.cutoffParam);
    this.filterEnvSource.start();

    this.operators = patch.operators.map(op => new Operator(ctx, op));

    this.lfoA = new Lfo(ctx);
    this.lfoB = new Lfo(ctx);

    // Fixed part of the chain. Operator routing is built in noteOn, once the
    // oscillators exist and their frequency params are reachable.
    if (patch.filter.enabled) {
      this.carrierMix.connect(this.filter.input);
      this.filter.output.connect(this.output);
    } else {
      this.carrierMix.connect(this.output);
    }
  }

  /**
   * Wire operators together according to the routing matrix.
   *
   * MUST run after every operator's noteOn, because an FM route needs the
   * target's oscillator frequency AudioParam, which only exists once the
   * oscillator has been created. Building this in the constructor (as the
   * original did) is what made the synth do amplitude modulation instead of FM.
   */
  private _buildRouting(time: number) {
    for (const route of this.routes) {
      const srcParams = this.patch.operators[route.from];
      if (!srcParams?.enabled) continue;
      const src = this.operators[route.from];
      if (!src) continue;

      if (route.to === 'out') {
        // Carrier: level is amplitude.
        const nominal = srcParams.level * route.amount;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(nominal, time);
        src.unitOut.connect(g);
        g.connect(this.carrierMix);
        this.routeGains.push(g);
        this.gainsBySource[route.from].push({ gain: g, nominal });
        continue;
      }

      const tgtParams = this.patch.operators[route.to];
      if (!tgtParams?.enabled) continue;
      const tgt = this.operators[route.to];
      if (!tgt) continue;

      if (route.kind === 'sync') {
        // Hard sync: the source's waveform drives the target's sync input, and
        // the target restarts its cycle on each rising edge. Only VCO operators
        // have a sync input — the stock OscillatorNode's phase is unreachable,
        // which is the whole reason the worklet oscillator exists.
        const syncIn = tgt.getSyncInput();
        if (!syncIn) {
          logger.warn(`sync route to op${route.to + 1} ignored: target is not a VCO`);
          continue;
        }
        src.unitOut.connect(syncIn);
        continue;
      }

      if (route.kind !== 'fm') {
        // ring / am arrive with the D-50 phase.
        logger.warn(`route kind '${route.kind}' not implemented, skipping`);
        continue;
      }

      const freqParam = tgt.getFrequencyParam();
      if (!freqParam) continue; // Karplus-Strong operators have no oscillator to modulate

      // Peak frequency deviation = index × modulator frequency. Scaling by the
      // modulator's own frequency is what holds timbre constant across the
      // keyboard instead of getting duller as you play higher.
      const depthHz = levelToIndex(srcParams.level) * route.amount * src.getFrequency();
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(depthHz, time);
      src.unitOut.connect(g);
      g.connect(freqParam);
      this.routeGains.push(g);
      this.gainsBySource[route.from].push({ gain: g, nominal: depthHz });
    }
  }

  noteOn(velocity: number, time: number) {
    const p = this.patch;
    this.velocity = velocity;

    // 1. Start every operator first — this creates the oscillators.
    p.operators.forEach((op, i) => {
      if (!op.enabled) return;
      this.operators[i].updateParams(op);
      if (op.wave === 'wavetable' && op.wavetableData) {
        this.operators[i].setWavetable(op.wavetableData);
      }
      this.operators[i].noteOn(this.noteHz, velocity, this.semitone, time);
    });

    // 2. Portamento: start at the previous note's pitch and slide into place.
    //    Done before routing so the FM index gains are computed against the
    //    destination frequency, which is where the note spends its life.
    const { glideFromHz, glideTime = 0 } = this.opts;
    if (glideFromHz && glideTime > 0) {
      p.operators.forEach((op, i) => {
        if (!op.enabled) return;
        this.operators[i].glideTo(this.noteHz, time, glideTime, glideFromHz);
      });
    }

    // 3. Now the frequency params exist, so routing can be built.
    this._buildRouting(time);

    // 4. Filter envelope.
    if (p.filter.enabled) {
      const fp = p.filter;
      const baseCutoff = fp.cutoff * Math.pow(2, fp.keytrack * (this.semitone - 60) / 12);
      const envRange = baseCutoff * (Math.pow(2, fp.envAmount * FILTER_ENV_OCTAVES) - 1);
      this.filter.cutoffParam.cancelScheduledValues(time);
      this.filter.cutoffParam.setValueAtTime(baseCutoff, time);
      scheduleEnvelope(this.filterEnvGain.gain, fp.env, time, envRange, velocity, this.semitone);
    }

    // 5. LFOs + mod matrix.
    const activeSlots = p.modMatrix.filter(s => s.enabled);
    const hasLfo1 = activeSlots.some(s => s.source === 'lfo1');
    const hasLfo2 = activeSlots.some(s => s.source === 'lfo2');
    if (hasLfo1) this.lfoA.start(p.lfo1, time);
    if (hasLfo2) this.lfoB.start(p.lfo2, time);

    for (const slot of activeSlots) {
      const lfo = slot.source === 'lfo1' ? this.lfoA : slot.source === 'lfo2' ? this.lfoB : null;
      if (!lfo) continue;
      const lfoDepth = slot.source === 'lfo1' ? p.lfo1.depth : p.lfo2.depth;
      const amount = slot.amount * lfoDepth;
      for (const t of this._getModTargets(slot.dest, amount)) {
        lfo.addConnection(t.param, t.scale);
      }
    }
  }

  /**
   * Change pitch on a sounding voice without retriggering anything — the legato
   * behaviour of a monosynth. Envelopes keep running, so a phrase played legato
   * has one attack rather than one per note.
   */
  glideTo(semitone: number, hz: number, time: number, glideTime: number) {
    this.semitone = semitone;
    this.noteHz = hz;
    this.patch.operators.forEach((op, i) => {
      if (!op.enabled) return;
      this.operators[i].glideTo(hz, time, glideTime);
    });

    // Key tracking means the filter's base cutoff follows the note too.
    const fp = this.patch.filter;
    if (fp.enabled && fp.keytrack) {
      const baseCutoff = fp.cutoff * Math.pow(2, fp.keytrack * (semitone - 60) / 12);
      const param = this.filter.cutoffParam;
      param.cancelScheduledValues(time);
      param.setValueAtTime(Math.max(1e-3, param.value), time);
      if (glideTime > 0) {
        param.exponentialRampToValueAtTime(Math.max(1e-3, baseCutoff), time + glideTime);
      } else {
        param.setValueAtTime(baseCutoff, time);
      }
    }
  }

  /** True while the voice has not been released — legato only reuses live voices. */
  get isSounding(): boolean { return this._endTime === Infinity; }

  /**
   * Resolve a mod destination to the AudioParams it drives, each with the swing
   * a unit (±1) modulator should produce.
   */
  private _getModTargets(dest: ModDest, amount: number): ModTarget[] {
    const p = this.patch;

    const opLvl = dest.match(/^op(\d)_level$/);
    if (opLvl) {
      const idx = +opLvl[1] - 1;
      // Modulate every outgoing stage of that operator, proportional to its
      // nominal value so the depth means the same thing for carriers and
      // modulators alike.
      return this.gainsBySource[idx].map(r => ({ param: r.gain.gain, scale: amount * r.nominal }));
    }

    const opRat = dest.match(/^op(\d)_ratio$/);
    if (opRat) {
      const idx = +opRat[1] - 1;
      const param = this.operators[idx]?.getFrequencyParam();
      if (!param) return [];
      return [{ param, scale: amount * this.operators[idx].getFrequency() * 0.06 }];
    }

    switch (dest) {
      case 'filter_cutoff':
        return [{ param: this.filter.cutoffParam, scale: amount * p.filter.cutoff }];
      case 'filter_res':
        return [{
          param: this.filter.resonanceParam,
          // Scale differs by model: worklets run resonance 0..1, biquad 0..30.
          scale: amount * this.filter.resonanceModScale(p.filter.resonance),
        }];
      case 'amp':
        return [{ param: this.output.gain, scale: amount * 0.5 }];
      case 'pitch':
        // Scale per operator by its own frequency, so a vibrato is the same
        // number of cents on every operator rather than detuning them apart.
        return this.operators
          .map((op, i) => ({ op, i }))
          .filter(({ i }) => p.operators[i]?.enabled)
          .map(({ op }) => {
            const param = op.getFrequencyParam();
            return param ? { param, scale: amount * op.getFrequency() * 0.06 } : null;
          })
          .filter((t): t is ModTarget => t !== null);
      default:
        // fx_reverb / fx_delay / fx_chorus are global, so AudioEngine wires them
        // on the FX bus rather than per voice.
        return [];
    }
  }

  noteOff(time: number) {
    const p = this.patch;
    let end = time;

    this.operators.forEach((op, i) => {
      if (!p.operators[i].enabled) return;
      end = Math.max(end, op.noteOff(time));
    });

    if (p.filter.enabled) {
      scheduleRelease(this.filterEnvGain.gain, p.filter.env, time, 0, this.velocity, this.semitone);
    }

    this._noteOffTime = time;
    this._endTime = end;

    // Let the LFOs ride the release tail rather than stopping dead on key-up.
    this.lfoA.stop(end);
    this.lfoB.stop(end);
  }

  /**
   * Longest release across *enabled* operators. Disabled operators used to
   * count, so a muted operator with a long release kept voices alive.
   */
  releaseTime(): number {
    const rels = this.patch.operators
      .filter(op => op.enabled)
      .map(op => releaseDuration(op.env, this.semitone));
    return rels.length ? Math.max(...rels) : 0.05;
  }

  /** Fade out fast — used when a voice is stolen, to avoid a click. */
  steal(time: number, fadeTime = 0.012) {
    const g = this.output.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + fadeTime);
    this._noteOffTime = time;
    this._endTime = time + fadeTime;
    this.lfoA.stop(time + fadeTime);
    this.lfoB.stop(time + fadeTime);
  }

  connectOperatorOutputsTo(targets: GainNode[]): void {
    for (let i = 0; i < Math.min(this.operators.length, targets.length); i++) {
      this.operators[i].unitOut.connect(targets[i]);
    }
  }

  disconnectOperatorOutputsFrom(targets: GainNode[]): void {
    for (let i = 0; i < Math.min(this.operators.length, targets.length); i++) {
      try { this.operators[i].unitOut.disconnect(targets[i]); } catch {}
    }
  }

  dispose() {
    this.operators.forEach(op => op.dispose());
    if (this.panner) { try { this.panner.disconnect(); } catch {} this.panner = null; }
    this.routeGains.forEach(g => { try { g.disconnect(); } catch {} });
    this.routeGains = [];
    this.gainsBySource = Array.from({ length: 6 }, () => []);
    this.lfoA.dispose();
    this.lfoB.dispose();
    try { this.filterEnvSource.stop(); } catch {}
    try { this.filterEnvSource.disconnect(); } catch {}
    try { this.filterEnvGain.disconnect(); } catch {}
    try { this.carrierMix.disconnect(); } catch {}
    this.filter.dispose();
    try { this.output.disconnect(); } catch {}
  }

  isExpired(time: number): boolean {
    return time > this._endTime + 0.1;
  }

  recordNoteOff(time: number) { this._noteOffTime = time; }
  get noteOffTime(): number { return this._noteOffTime; }
}
