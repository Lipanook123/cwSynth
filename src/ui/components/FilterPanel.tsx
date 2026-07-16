import React from 'react';
import { FilterParams, FilterType } from '../../engine/Types';
import { Knob } from './Knob';

const FILTER_TYPES: FilterType[] = ['lowpass','highpass','bandpass','notch'];

interface Props { params: FilterParams; onChange: (p: Partial<FilterParams>) => void; }

export const FilterPanel: React.FC<Props> = ({ params, onChange }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
      <span style={{ fontSize:8, fontWeight:600, letterSpacing:'.15em', color:'var(--amber)', textTransform:'uppercase' }}>Resonant Filter</span>
      <button onClick={() => onChange({ enabled: !params.enabled })}
        style={{ width:36, height:20, borderRadius:10, border:'none', cursor:'pointer',
          background: params.enabled ? 'rgba(255,170,74,.2)' : 'var(--bord)', position:'relative' }}>
        <div style={{ position:'absolute', top:2, left: params.enabled ? 16 : 2, width:16, height:16,
          borderRadius:'50%', background: params.enabled ? 'var(--amber)' : 'var(--muted)', transition:'left .15s' }}/>
      </button>
    </div>

    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:3 }}>
      {FILTER_TYPES.map(t => (
        <button key={t} onClick={() => onChange({ type: t })}
          style={{ padding:'6px 0', borderRadius:3, border:`1px solid ${params.type===t?'var(--amber)':'var(--bord)'}`,
            background: params.type===t ? 'var(--amber)22' : 'none', color: params.type===t ? 'var(--amber)' : 'var(--muted)',
            fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer' }}>{t.replace('pass','').replace('notch','ntch')}</button>
      ))}
    </div>

    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
      <Knob value={params.cutoff} min={20} max={20000} step={1}
        label="cutoff" display={v => v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v)+'Hz'}
        color="var(--amber)" onChange={v => onChange({ cutoff: v })} size={44} />
      <Knob value={params.resonance} min={0.1} max={30} step={0.1}
        label="res" display={v => v.toFixed(1)} color="var(--amber)"
        onChange={v => onChange({ resonance: v })} size={44} />
      <Knob value={params.envAmount} min={-1} max={1} step={0.01}
        label="env amt" display={v => (v>=0?'+':'')+Math.round(v*100)+'%'} color="var(--amber)"
        onChange={v => onChange({ envAmount: v })} size={44} />
      <Knob value={params.keytrack} min={0} max={1} step={0.01}
        label="keytrack" display={v => Math.round(v*100)+'%'} color="var(--amber)"
        onChange={v => onChange({ keytrack: v })} size={44} />
    </div>

    <div style={{ borderTop:'1px solid var(--bord)', paddingTop:8 }}>
      <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.12em', textTransform:'uppercase' }}>Envelope</span>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginTop:8 }}>
        {(['attack','decay','sustain','release'] as const).map(k => (
          <Knob key={k} value={params[k]}
            min={k === 'sustain' ? 0 : 0.001} max={k === 'sustain' ? 1 : 4} step={k === 'sustain' ? 0.01 : 0.001}
            label={k[0].toUpperCase()}
            display={k === 'sustain' ? v => Math.round(v*100)+'%' : v => v < 1 ? Math.round(v*1000)+'ms' : v.toFixed(1)+'s'}
            color="var(--amber)" onChange={v => onChange({ [k]: v })} size={40} />
        ))}
      </div>
    </div>
  </div>
);
