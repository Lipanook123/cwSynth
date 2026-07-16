import React from 'react';
import { OperatorParams, WaveType } from '../../engine/Types';
import { Knob } from './Knob';
import { RandomControls } from './RandomControls';
import { RandomMode } from '../../engine/Randomiser';

const OP_COLORS = ['#4a9eff','#7b6fff','#ff6b9d','#ffaa4a','#4af0a0','#ff4a6b'];
const WAVES: WaveType[] = ['sine','triangle','sawtooth','square'];
const WAVE_LABELS = ['sin','tri','saw','sq'];

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

      {/* Waveform */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:3 }}>
        {WAVES.map((w, i) => (
          <button key={w} onClick={() => onChange({ wave: w, karplusStrong: false })}
            style={{
              padding:'5px 0', borderRadius:3, border:'1px solid var(--bord)',
              background: params.wave === w && !params.karplusStrong ? col : 'none',
              color: params.wave === w && !params.karplusStrong ? 'var(--bg)' : 'var(--muted)',
              fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', transition:'all .1s',
            }}>{WAVE_LABELS[i]}</button>
        ))}
      </div>
      <button onClick={() => onChange({ karplusStrong: !params.karplusStrong })}
        style={{
          padding:'5px 0', borderRadius:3, border:`1px solid ${params.karplusStrong ? 'var(--amber)' : 'var(--bord)'}`,
          background: params.karplusStrong ? 'var(--amber)' : 'none',
          color: params.karplusStrong ? 'var(--bg)' : 'var(--muted)',
          fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer', width:'100%',
        }}>karplus-strong</button>

      {/* Knobs: ratio, fine, level, feedback */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4 }}>
        <Knob value={params.ratio} min={0.5} max={16} step={0.01}
          label="ratio" display={v => v.toFixed(2)} color={col}
          onChange={v => onChange({ ratio: v })} size={40} />
        <Knob value={params.fine} min={-100} max={100} step={1}
          label="fine" display={v => (v > 0 ? '+' : '') + v + '¢'} color={col}
          onChange={v => onChange({ fine: v })} size={40} />
        <Knob value={params.level} min={0} max={1} step={0.01}
          label="level" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ level: v })} size={40} />
        <Knob value={params.feedback} min={0} max={1} step={0.01}
          label="fdbk" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ feedback: v })} size={40} />
      </div>

      {/* ADSR knobs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4 }}>
        <Knob value={params.attack}  min={0.001} max={4} step={0.001}
          label="A" display={v => v < 1 ? Math.round(v*1000)+'ms' : v.toFixed(1)+'s'} color={col}
          onChange={v => onChange({ attack: v })} size={40} />
        <Knob value={params.decay}   min={0.001} max={8} step={0.001}
          label="D" display={v => v < 1 ? Math.round(v*1000)+'ms' : v.toFixed(1)+'s'} color={col}
          onChange={v => onChange({ decay: v })} size={40} />
        <Knob value={params.sustain} min={0} max={1} step={0.01}
          label="S" display={v => Math.round(v*100)+'%'} color={col}
          onChange={v => onChange({ sustain: v })} size={40} />
        <Knob value={params.release} min={0.001} max={8} step={0.001}
          label="R" display={v => v < 1 ? Math.round(v*1000)+'ms' : v.toFixed(1)+'s'} color={col}
          onChange={v => onChange({ release: v })} size={40} />
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
