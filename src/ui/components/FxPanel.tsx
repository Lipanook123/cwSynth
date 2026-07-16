import React from 'react';
import type { FxParams } from '../../engine/Types';
import { Knob } from './Knob';

interface Props { params: FxParams; onChange: (p: Partial<FxParams>) => void; }

const Section: React.FC<{
  label: string; color: string; enabled: boolean; onToggle: () => void; children: React.ReactNode;
}> = ({ label, color, enabled, onToggle, children }) => (
  <div style={{ background:'var(--surf)', borderRadius:6, padding:'10px 10px 12px',
    border:`1px solid ${enabled ? color+'44' : 'var(--bord)'}`, opacity: enabled ? 1 : 0.55,
    transition:'opacity .15s, border-color .15s', display:'flex', flexDirection:'column', gap:8 }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
      <span style={{ fontSize:9, fontWeight:600, color, letterSpacing:'.12em', textTransform:'uppercase' }}>{label}</span>
      <button onClick={onToggle} style={{ width:36, height:20, borderRadius:10, border:'none', cursor:'pointer',
        background: enabled ? color+'33' : 'var(--bord)', position:'relative' }}>
        <div style={{ position:'absolute', top:2, left: enabled ? 16 : 2, width:16, height:16,
          borderRadius:'50%', background: enabled ? color : 'var(--muted)', transition:'left .15s, background .15s' }}/>
      </button>
    </div>
    {children}
  </div>
);

export const FxPanel: React.FC<Props> = ({ params, onChange }) => {
  const upd = <K extends keyof FxParams>(key: K, val: Partial<FxParams[K]>) =>
    onChange({ [key]: { ...params[key], ...val } } as any);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

      <Section label="Reverb" color="var(--op3)" enabled={params.reverb.enabled}
        onToggle={() => upd('reverb', { enabled: !params.reverb.enabled })}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
          <Knob value={params.reverb.size} min={0} max={1} step={0.01} label="size"
            display={v => Math.round(v*100)+'%'} color="var(--op3)" onChange={v => upd('reverb',{size:v})} size={40}/>
          <Knob value={params.reverb.damp} min={0} max={1} step={0.01} label="damp"
            display={v => Math.round(v*100)+'%'} color="var(--op3)" onChange={v => upd('reverb',{damp:v})} size={40}/>
          <Knob value={params.reverb.mix}  min={0} max={1} step={0.01} label="mix"
            display={v => Math.round(v*100)+'%'} color="var(--op3)" onChange={v => upd('reverb',{mix:v})} size={40}/>
        </div>
      </Section>

      <Section label="Delay" color="var(--blue)" enabled={params.delay.enabled}
        onToggle={() => upd('delay', { enabled: !params.delay.enabled })}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
          <Knob value={params.delay.time} min={0.05} max={2} step={0.001} label="time"
            display={v => (v*1000).toFixed(0)+'ms'} color="var(--blue)" onChange={v => upd('delay',{time:v})} size={40}/>
          <Knob value={params.delay.feedback} min={0} max={0.95} step={0.01} label="fdbk"
            display={v => Math.round(v*100)+'%'} color="var(--blue)" onChange={v => upd('delay',{feedback:v})} size={40}/>
          <Knob value={params.delay.mix} min={0} max={1} step={0.01} label="mix"
            display={v => Math.round(v*100)+'%'} color="var(--blue)" onChange={v => upd('delay',{mix:v})} size={40}/>
        </div>
      </Section>

      <Section label="Chorus" color="var(--op2)" enabled={params.chorus.enabled}
        onToggle={() => upd('chorus', { enabled: !params.chorus.enabled })}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
          <Knob value={params.chorus.rate}  min={0.05} max={8} step={0.01} label="rate"
            display={v => v.toFixed(2)+'Hz'} color="var(--op2)" onChange={v => upd('chorus',{rate:v})} size={40}/>
          <Knob value={params.chorus.depth} min={0}    max={1}  step={0.01} label="depth"
            display={v => Math.round(v*100)+'%'} color="var(--op2)" onChange={v => upd('chorus',{depth:v})} size={40}/>
          <Knob value={params.chorus.mix}   min={0}    max={1}  step={0.01} label="mix"
            display={v => Math.round(v*100)+'%'} color="var(--op2)" onChange={v => upd('chorus',{mix:v})} size={40}/>
        </div>
      </Section>

      <Section label="Distortion" color="var(--red)" enabled={params.dist.enabled}
        onToggle={() => upd('dist', { enabled: !params.dist.enabled })}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:3, marginBottom:6 }}>
          {(['soft','hard','bit'] as const).map(m => (
            <button key={m} onClick={() => upd('dist', { mode: m })}
              style={{ padding:'5px 0', borderRadius:3, border:`1px solid ${params.dist.mode===m?'var(--red)':'var(--bord)'}`,
                background: params.dist.mode===m ? 'var(--red)22' : 'none', color: params.dist.mode===m ? 'var(--red)' : 'var(--muted)',
                fontFamily:'IBM Plex Mono', fontSize:8, cursor:'pointer' }}>{m}</button>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
          <Knob value={params.dist.drive} min={0} max={10} step={0.1} label="drive"
            display={v => v.toFixed(1)} color="var(--red)" onChange={v => upd('dist',{drive:v})} size={40}/>
          <Knob value={params.dist.tone}  min={0} max={1}  step={0.01} label="tone"
            display={v => Math.round(v*100)+'%'} color="var(--red)" onChange={v => upd('dist',{tone:v})} size={40}/>
          <Knob value={params.dist.mix}   min={0} max={1}  step={0.01} label="mix"
            display={v => Math.round(v*100)+'%'} color="var(--red)" onChange={v => upd('dist',{mix:v})} size={40}/>
        </div>
      </Section>

      <Section label="EQ" color="var(--acc)" enabled={params.eq.enabled}
        onToggle={() => upd('eq', { enabled: !params.eq.enabled })}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          <Knob value={params.eq.low}  min={-18} max={18} step={0.5} label="low"
            display={v => (v>=0?'+':'')+v.toFixed(1)+'dB'} color="var(--acc)" onChange={v => upd('eq',{low:v})} size={40}/>
          <Knob value={params.eq.mid}  min={-18} max={18} step={0.5} label="mid"
            display={v => (v>=0?'+':'')+v.toFixed(1)+'dB'} color="var(--acc)" onChange={v => upd('eq',{mid:v})} size={40}/>
          <Knob value={params.eq.high} min={-18} max={18} step={0.5} label="high"
            display={v => (v>=0?'+':'')+v.toFixed(1)+'dB'} color="var(--acc)" onChange={v => upd('eq',{high:v})} size={40}/>
          <Knob value={params.eq.midFreq} min={200} max={8000} step={10} label="mf"
            display={v => v>=1000?(v/1000).toFixed(1)+'k':Math.round(v)+'Hz'} color="var(--acc)"
            onChange={v => upd('eq',{midFreq:v})} size={40}/>
        </div>
      </Section>
    </div>
  );
};
