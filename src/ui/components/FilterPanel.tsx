import React from 'react';
import type { FilterParams, FilterType, FilterModel } from '../../engine/Types';
import { Knob } from './Knob';
import { AdsrKnobs } from './AdsrKnobs';

const FILTER_TYPES: FilterType[] = ['lowpass','highpass','bandpass','notch'];

const MODELS: { id: FilterModel; label: string; hint: string }[] = [
  { id: 'biquad', label: 'clean',  hint: 'Stock Web Audio biquad — neutral, no self-oscillation' },
  { id: 'ladder', label: 'ladder', hint: 'Moog-style 4-pole ladder — self-oscillates, loses bass with resonance' },
  { id: 'svf',    label: 'svf',    hint: 'State-variable — Oberheim/Prophet flavour, softer and more open' },
];

interface Props { params: FilterParams; onChange: (p: Partial<FilterParams>) => void; }

export const FilterPanel: React.FC<Props> = ({ params, onChange }) => {
  const isAnalog = params.model !== 'biquad';
  return (
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

    {/* Filter character. `biquad` is the stock Web Audio node — clean, and often
        what an FM patch wants. The other two are worklet models that resonate
        and saturate the way the classic analog synths do. */}
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:3 }}>
      {MODELS.map(m => (
        <button key={m.id} onClick={() => onChange({ model: m.id })}
          title={m.hint}
          style={{ padding:'6px 0', borderRadius:3, border:`1px solid ${params.model===m.id?'var(--amber)':'var(--bord)'}`,
            background: params.model===m.id ? 'var(--amber)22' : 'none', color: params.model===m.id ? 'var(--amber)' : 'var(--muted)',
            fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer' }}>{m.label}</button>
      ))}
    </div>

    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:3 }}>
      {FILTER_TYPES.map(t => (
        <button key={t} onClick={() => onChange({ type: t })}
          style={{ padding:'6px 0', borderRadius:3, border:`1px solid ${params.type===t?'var(--amber)':'var(--bord)'}`,
            background: params.type===t ? 'var(--amber)22' : 'none', color: params.type===t ? 'var(--amber)' : 'var(--muted)',
            fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer' }}>{t.replace('pass','').replace('notch','ntch')}</button>
      ))}
    </div>

    {isAnalog && (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:3 }}>
        {([12, 24] as const).map(s => (
          <button key={s} onClick={() => onChange({ slope: s })}
            style={{ padding:'6px 0', borderRadius:3, border:`1px solid ${params.slope===s?'var(--amber)':'var(--bord)'}`,
              background: params.slope===s ? 'var(--amber)22' : 'none', color: params.slope===s ? 'var(--amber)' : 'var(--muted)',
              fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer' }}>{s} dB/oct</button>
        ))}
      </div>
    )}

    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
      <Knob value={params.cutoff} min={20} max={20000} step={1}
        label="cutoff" display={v => v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v)+'Hz'}
        color="var(--amber)" onChange={v => onChange({ cutoff: v })} size={44} />
      <Knob value={params.resonance} min={0.1} max={30} step={0.1}
        label="res"
        // Analog models self-oscillate at the top of the range, so show the
        // normalised value there rather than a Q figure that means nothing.
        display={v => isAnalog ? Math.round((v / 30) * 100) + '%' : v.toFixed(1)}
        color="var(--amber)" onChange={v => onChange({ resonance: v })} size={44} />
      <Knob value={params.envAmount} min={-1} max={1} step={0.01}
        label="env amt" display={v => (v>=0?'+':'')+Math.round(v*100)+'%'} color="var(--amber)"
        onChange={v => onChange({ envAmount: v })} size={44} />
      <Knob value={params.keytrack} min={0} max={1} step={0.01}
        label="keytrack" display={v => Math.round(v*100)+'%'} color="var(--amber)"
        onChange={v => onChange({ keytrack: v })} size={44} />
      {isAnalog && (
        <Knob value={params.drive} min={0} max={1} step={0.01}
          label="drive" display={v => Math.round(v*100)+'%'} color="var(--amber)"
          onChange={v => onChange({ drive: v })} size={44} />
      )}
      {/* Series non-resonant highpass ahead of the main filter — the Jupiter-8
          topology. 20 Hz means bypassed. */}
      <Knob value={params.hpfCutoff} min={20} max={2000} step={1}
        label="hpf" display={v => v <= 25 ? 'off' : (v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v)+'Hz')}
        color="var(--amber)" onChange={v => onChange({ hpfCutoff: v })} size={44} />
    </div>

    <div style={{ borderTop:'1px solid var(--bord)', paddingTop:8 }}>
      <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.12em', textTransform:'uppercase' }}>Envelope</span>
      <div style={{ marginTop:8 }}>
        <AdsrKnobs env={params.env} color="var(--amber)" maxTime={4}
          onChange={env => onChange({ env })} />
      </div>
    </div>
  </div>
  );
};
