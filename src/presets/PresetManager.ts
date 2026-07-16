import { PatchParams, DEFAULT_PATCH } from '../engine/Types';

export interface PresetMeta {
  id: string;
  name: string;
  author: string;
  tags: string[];
  patch: PatchParams;
}

const parsePatch = (raw: string): PatchParams => {
  try { return { ...DEFAULT_PATCH, ...JSON.parse(raw) }; }
  catch { return DEFAULT_PATCH; }
};

// Inline factory presets to avoid asset import issues
const WHISTLE_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Whistle', author: 'CW Synth', tags: ['wind','organic'],
  algorithm: 5,
  operators: [
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,    fine:2,  fixed:false, fixedFreq:440, level:0.8, feedback:0.02, attack:0.01,  decay:0.15, sustain:0.8,  release:0.1,  karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1.99, fine:0,  fixed:false, fixedFreq:440, level:0.8, feedback:0,    attack:0.002, decay:0.2,  sustain:0.5,  release:0.1,  karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,    fine:-2, fixed:false, fixedFreq:440, level:0.12,feedback:0,    attack:0.005, decay:0.06, sustain:0.12, release:0.04, karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,    fine:0,  fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,    fine:0,  fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,    fine:0,  fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
  ],
  fx: { reverb:{enabled:true,size:0.4,damp:0.6,mix:0.15}, delay:{enabled:false,time:0.3,feedback:0.3,mix:0.2,sync:false}, chorus:{enabled:false,rate:0.5,depth:0.3,mix:0.4}, dist:{enabled:false,drive:2,tone:0.5,mix:0.5,mode:'soft'}, eq:{enabled:true,low:-3,mid:2,high:1,midFreq:3000} },
  volume: 0.65,
};

const EP_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'E. Piano', author: 'CW Synth', tags: ['keys','warm'],
  algorithm: 5,
  operators: [
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,  fine:0, fixed:false, fixedFreq:440, level:1.0, feedback:0, attack:0.001, decay:0.8, sustain:0.0,  release:0.5, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:14, fine:0, fixed:false, fixedFreq:440, level:0.6, feedback:0, attack:0.001, decay:0.4, sustain:0.0,  release:0.3, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,  fine:0, fixed:false, fixedFreq:440, level:0.8, feedback:0, attack:0.001, decay:1.2, sustain:0.0,  release:0.6, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:14, fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0, attack:0.001, decay:0.6, sustain:0.0,  release:0.3, karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,  fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0, attack:0.01,  decay:0.3, sustain:0.5,  release:0.3, karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,  fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0, attack:0.01,  decay:0.3, sustain:0.5,  release:0.3, karplusStrong:false, ksDecay:0.995 },
  ],
  fx: { reverb:{enabled:true,size:0.5,damp:0.5,mix:0.2}, delay:{enabled:false,time:0.375,feedback:0.4,mix:0.2,sync:false}, chorus:{enabled:true,rate:0.4,depth:0.2,mix:0.3}, dist:{enabled:false,drive:2,tone:0.5,mix:0.5,mode:'soft'}, eq:{enabled:false,low:0,mid:0,high:0,midFreq:1000} },
  volume: 0.75,
};

const BELL_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Bell', author: 'CW Synth', tags: ['bell','metallic'],
  algorithm: 3,
  operators: [
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,   fine:0, fixed:false, fixedFreq:440, level:1.0, feedback:0, attack:0.001, decay:2.0, sustain:0.0, release:1.5, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:3.5, fine:0, fixed:false, fixedFreq:440, level:0.8, feedback:0, attack:0.001, decay:1.0, sustain:0.0, release:0.8, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1,   fine:0, fixed:false, fixedFreq:440, level:0.9, feedback:0, attack:0.001, decay:2.5, sustain:0.0, release:2.0, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:5.0, fine:0, fixed:false, fixedFreq:440, level:0.6, feedback:0, attack:0.001, decay:0.8, sustain:0.0, release:0.5, karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,   fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0, attack:0.01,  decay:0.3, sustain:0.5, release:0.3, karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1,   fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0, attack:0.01,  decay:0.3, sustain:0.5, release:0.3, karplusStrong:false, ksDecay:0.995 },
  ],
  fx: { reverb:{enabled:true,size:0.8,damp:0.3,mix:0.35}, delay:{enabled:true,time:0.5,feedback:0.3,mix:0.15,sync:false}, chorus:{enabled:false,rate:0.5,depth:0.3,mix:0.4}, dist:{enabled:false,drive:2,tone:0.5,mix:0.5,mode:'soft'}, eq:{enabled:false,low:0,mid:0,high:0,midFreq:1000} },
  volume: 0.7,
};

const BASS_PATCH: PatchParams = {
  ...DEFAULT_PATCH,
  name: 'Synth Bass', author: 'CW Synth', tags: ['bass','punchy'],
  algorithm: 1,
  operators: [
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1, fine:0, fixed:false, fixedFreq:440, level:1.0, feedback:0.15, attack:0.001, decay:0.3,  sustain:0.6,  release:0.15, karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:1, fine:0, fixed:false, fixedFreq:440, level:0.9, feedback:0,    attack:0.001, decay:0.15, sustain:0.3,  release:0.1,  karplusStrong:false, ksDecay:0.995 },
    { enabled:true,  wave:'sine', wavetableData:null, ratio:2, fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.001, decay:0.1,  sustain:0.0,  release:0.1,  karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1, fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1, fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
    { enabled:false, wave:'sine', wavetableData:null, ratio:1, fine:0, fixed:false, fixedFreq:440, level:0.5, feedback:0,    attack:0.01,  decay:0.3,  sustain:0.5,  release:0.3,  karplusStrong:false, ksDecay:0.995 },
  ],
  filter: { enabled:true, type:'lowpass', cutoff:800, resonance:4, envAmount:0.6, attack:0.005, decay:0.25, sustain:0.1, release:0.2, keytrack:0.3 },
  fx: { reverb:{enabled:false,size:0.3,damp:0.7,mix:0.1}, delay:{enabled:false,time:0.375,feedback:0.3,mix:0.15,sync:false}, chorus:{enabled:false,rate:0.5,depth:0.3,mix:0.4}, dist:{enabled:true,drive:1.5,tone:0.4,mix:0.3,mode:'soft'}, eq:{enabled:true,low:3,mid:-2,high:-1,midFreq:500} },
  volume: 0.8,
};

export const FACTORY_PRESETS: PresetMeta[] = [
  { id:'init',    name:'Init',       author:'CW Synth', tags:['init'],           patch:DEFAULT_PATCH },
  { id:'whistle', name:'Whistle',    author:'CW Synth', tags:['wind','organic'], patch:WHISTLE_PATCH },
  { id:'ep',      name:'E. Piano',   author:'CW Synth', tags:['keys','warm'],    patch:EP_PATCH },
  { id:'bell',    name:'Bell',       author:'CW Synth', tags:['bell','metallic'],patch:BELL_PATCH },
  { id:'bass',    name:'Synth Bass', author:'CW Synth', tags:['bass','punchy'],  patch:BASS_PATCH },
];

const USER_KEY = 'cwsynth_user_presets';

export class PresetManager {
  private userPresets: PresetMeta[] = [];
  constructor() { this._loadFromStorage(); }
  all(): PresetMeta[] { return [...FACTORY_PRESETS, ...this.userPresets]; }

  save(name: string, patch: PatchParams, tags: string[] = []) {
    const id = `user_${Date.now()}`;
    const meta: PresetMeta = { id, name, author:'User', tags, patch };
    this.userPresets.push(meta);
    this._saveToStorage();
    return meta;
  }
  delete(id: string) { this.userPresets = this.userPresets.filter(p => p.id !== id); this._saveToStorage(); }

  exportFile(patch: PatchParams, name: string) {
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/\s+/g,'_')}.cwsyn`;
    a.click();
  }
  async importFile(file: File): Promise<PatchParams> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => { try { res({ ...DEFAULT_PATCH, ...JSON.parse(e.target!.result as string) }); } catch { rej(new Error('Invalid .cwsyn file')); } };
      r.readAsText(file);
    });
  }
  private _loadFromStorage() { try { const r = localStorage.getItem(USER_KEY); if (r) this.userPresets = JSON.parse(r); } catch {} }
  private _saveToStorage() { try { localStorage.setItem(USER_KEY, JSON.stringify(this.userPresets)); } catch {} }
}

export const presetManager = new PresetManager();
