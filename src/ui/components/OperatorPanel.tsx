import React from 'react';
import type { OperatorParams, WaveType, OpRole } from '../../engine/Types';
import { Knob } from './Knob';
import { AdsrKnobs, toggleEnvShape, isAdsrShaped } from './AdsrKnobs';
import { levelToIndex } from '../../engine/Operator';
import { RandomControls } from './RandomControls';
import type { RandomMode } from '../../engine/Randomiser';

const OP_COLORS = ['#4a9eff','#7b6fff','#ff6b9d','#ffaa4a','#4af0a0','#ff4a6b'];
const WAVES: WaveType[] = ['sine','triangle','sawtooth','square'];
const WAVE_LABELS = ['sin','tri','saw','sq'];

// The worklet oscillator leads with saw and pulse — the analog staples — and its
// square is a pulse at 50%, so pulse width is always live.
const VCO_WAVES: WaveType[] = ['sawtooth','square','triangle','sine'];
const VCO_WAVE_LABELS = ['saw','pulse','tri','sin'];

const ROLES: { id: OpRole; label: string; hint: string }[] = [
  { id: 'fm',    label: 'fm',    hint: 'Clean band-limited oscillator — the DX-7 operator' },
  { id: 'vco',   label: 'vco',   hint: 'Analog oscillator — pulse width, hard sync, drift' },
  { id: 'noise', label: 'noise', hint: 'White or pink noise source' },
];

interface Props {
  index: number;
  params: OperatorParams;
  isCarrier: boolean;
  onChange: (p: Partial<OperatorParams>) => void;
  onRandomise: (seed: string, mode: RandomMode) => void;
  rMode: RandomMode;
  rSeed: string;
}

export const OperatorPanel: React.FC<Props> = ({ index, params, isCarrier, onChange, onRandomise, rMode, rSeed }) => {
  const col = OP_COLORS[index];

  return (
    <div style={{
      background:'var(--surf)', borderRadius:6, padding:'10px 10px 12px',
      border:`1px solid ${params.enabled ? col + '44' : 'var(--bord)'}`,
      opacity: params.enabled ? 1 : 0.45, transition:'opacity .15s, border-color .15s',
      display:'flex', flexDirection:'column', gap:8,
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:10, fontWeight:600, color:col, letterSpacing:'.1em' }}>OP{index+1}</span>
        <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.1em', textTransform:'uppercase', flex:1 }}>
          {isCarrier ? 'carrier' : 'modulator'}
        </span>
        {params.karplusStrong && (
          <span style={{ fontSize:8, color:'var(--amber)', letterSpacing:'.06em' }}>KS</span>
        )}
        <RandomControls
          mode={rMode} seed={rSeed}
          onModeChange={() => {}} onSeedChange={() => {}}
          onRandomise={onRandomise}
          compact color={col}
        />
        <button
          onClick={() => onChange({ enabled: !params.enabled })}
          style={{
            width:28, height:16, borderRadius:8, border:'none', cursor:'pointer',
            background: params.enabled ? col + '33' : 'var(--bord)',
            position:'relative', flexShrink:0, transition:'background .15s',
          }}
        >
          <div style={{
            position:'absolute', top:2, left: params.enabled ? 12 : 2,
            width:12, height:12, borderRadius:'50%',
            background: params.enabled ? col : 'var(--muted)',
            transition:'left .15s, background .15s',
          }}/>
        </button>
      </div>

      {/* Operator role. `fm` is a clean band-limited oscillator; `vco` is the
          worklet analog oscillator with PWM and hard sync; `noise` is a source. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:3 }}>
        {ROLES.map(r => (
          <button key={r.id} onClick={() => onChange({ role: r.id, karplusStrong: false })}
            title={r.hint}
            style={{
              padding:'5px 0', borderRadius:3,
              border:`1px solid ${params.role === r.id ? col : 'var(--bord)'}`,
              background: params.role === r.id ? col + '22' : 'none',
              color: params.role === r.id ? col : 'var(--muted)',
              fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', transition:'all .1s',
            }}>{r.label}</button>
        ))}
      </div>

      {/* Waveform */}
      {params.role === 'noise' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:3 }}>
          {(['white','pink'] as const).map(n => (
            <button key={n} onClick={() => onChange({ noiseType: n })}
              style={{
                padding:'5px 0', borderRadius:3,
                border:`1px solid ${params.noiseType === n ? col : 'var(--bord)'}`,
                background: params.noiseType === n ? col + '22' : 'none',
                color: params.noiseType === n ? col : 'var(--muted)',
                fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer',
              }}>{n}</button>
          ))}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:3 }}>
          {(params.role === 'vco' ? VCO_WAVES : WAVES).map((w, i) => (
            <button key={w} onClick={() => onChange({ wave: w, karplusStrong: false })}
              style={{
                padding:'5px 0', borderRadius:3, border:'1px solid var(--bord)',
                background: params.wave === w && !params.karplusStrong ? col : 'none',
                color: params.wave === w && !params.karplusStrong ? 'var(--bg)' : 'var(--muted)',
                fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', transition:'all .1s',
              }}>{(params.role === 'vco' ? VCO_WAVE_LABELS : WAVE_LABELS)[i]}</button>
          ))}
        </div>
      )}
      <button onClick={() => onChange({ karplusStrong: !params.karplusStrong })}
        style={{
          padding:'5px 0', borderRadius:3, border:`1px solid ${params.karplusStrong ? 'var(--amber)' : 'var(--bord)'}`,
          background: params.karplusStrong ? 'var(--amber)' : 'none',
          color: params.karplusStrong ? 'var(--bg)' : 'var(--muted)',
          fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', width:'100%',
        }}>karplus-strong</button>

      {/* Pitch: fixed-frequency operators ignore the played note entirely. */}
      <button onClick={() => onChange({ fixed: !params.fixed })}
        style={{
          padding:'4px 0', borderRadius:3, border:`1px solid ${params.fixed ? col : 'var(--bord)'}`,
          background: params.fixed ? col + '22' : 'none', color: params.fixed ? col : 'var(--muted)',
          fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', width:'100%',
        }}>{params.fixed ? 'fixed freq' : 'key track'}</button>

      {/* Knobs: ratio/fixed freq, fine, level, feedback */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4 }}>
        {params.fixed ? (
          <Knob value={params.fixedFreq} min={1} max={8000} step={1}
            label="Hz" display={v => v >= 1000 ? (v/1000).toFixed(2)+'k' : Math.round(v)+''} color={col}
            onChange={v => onChange({ fixedFreq: v })} size={40} />
        ) : (
          <Knob value={params.ratio} min={0.5} max={16} step={0.01}
            label="ratio" display={v => v.toFixed(2)} color={col}
            onChange={v => onChange({ ratio: v })} size={40} />
        )}
        <Knob value={params.fine} min={-100} max={100} step={1}
          label="fine" display={v => (v > 0 ? '+' : '') + v + '¢'} color={col}
          onChange={v => onChange({ fine: v })} size={40} />
        <Knob value={params.level} min={0} max={1} step={0.01}
          label={isCarrier ? 'level' : 'index'}
          display={v => isCarrier ? Math.round(v*100)+'%' : levelToIndex(v).toFixed(1)}
          color={col} onChange={v => onChange({ level: v })} size={40} />
        <Knob value={params.feedback} min={0} max={1} step={0.01}
          label="fdbk" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ feedback: v })} size={40} />
      </div>

      {params.role === 'vco' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:4 }}>
          <Knob value={params.pulseWidth} min={0.02} max={0.98} step={0.01}
            label="width" display={v => Math.round(v*100)+'%'} color={col}
            onChange={v => onChange({ pulseWidth: v })} size={40} />
          <Knob value={params.drift} min={0} max={1} step={0.01}
            label="drift" display={v => Math.round(v*100)+'%'} color={col}
            onChange={v => onChange({ drift: v })} size={40} />
        </div>
      )}

      {/* Envelope */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.12em', textTransform:'uppercase', flex:1 }}>
          {isAdsrShaped(params.env) ? 'adsr' : 'rate / level'}
        </span>
        <button onClick={() => onChange({ env: toggleEnvShape(params.env) })}
          style={{
            padding:'2px 6px', borderRadius:3, border:'1px solid var(--bord)', background:'none',
            color:'var(--muted)', fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer',
          }}>{isAdsrShaped(params.env) ? '→ 4-stage' : '→ adsr'}</button>
      </div>
      <AdsrKnobs env={params.env} color={col} maxTime={8}
        onChange={env => onChange({ env })} />

      {/* Keyboard response — the DX-7's per-operator scaling. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4 }}>
        <Knob value={params.env.velSens} min={0} max={1} step={0.01}
          label="vel" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ env: { ...params.env, velSens: v } })} size={40} />
        <Knob value={params.env.keyRateScale} min={0} max={1} step={0.01}
          label="rate scl" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ env: { ...params.env, keyRateScale: v } })} size={40} />
        <Knob value={params.env.keyLevelScale} min={-1} max={1} step={0.01}
          label="lvl scl" display={v => (v>=0?'+':'')+Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ env: { ...params.env, keyLevelScale: v } })} size={40} />
      </div>

      {params.karplusStrong && (
        <div style={{ display:'flex', justifyContent:'center' }}>
          <Knob value={params.ksDecay} min={0.9} max={0.9999} step={0.0001}
            label="ks decay" display={v => v.toFixed(4)} color="var(--amber)"
            onChange={v => onChange({ ksDecay: v })} size={40} />
        </div>
      )}
    </div>
  );
};
