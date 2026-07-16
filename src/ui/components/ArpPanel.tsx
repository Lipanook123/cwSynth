import React from 'react';
import { engine } from '../../engine/AudioEngine';
import { Knob } from './Knob';

type ArpPattern = 'up' | 'down' | 'updown' | 'random';
type HoldMode   = 'hold' | 'latch';

interface ArpState {
  enabled: boolean;
  pattern: ArpPattern;
  holdMode: HoldMode;
  rate: number;
  gate: number;
  octaves: number;
}

interface Props {
  state: ArpState;
  onChange: (s: Partial<ArpState>) => void;
}

const PATTERNS: { id: ArpPattern; label: string }[] = [
  { id:'up',     label:'↑ up' },
  { id:'down',   label:'↓ down' },
  { id:'updown', label:'↕ u-d' },
  { id:'random', label:'? rnd' },
];

export const ArpPanel: React.FC<Props> = ({ state, onChange }) => {
  const update = (partial: Partial<ArpState>) => {
    onChange(partial);
    const arp = engine.arp;
    if (!arp) return;
    if (partial.pattern  !== undefined) arp.setPattern(partial.pattern);
    if (partial.holdMode !== undefined) arp.setHoldMode(partial.holdMode);
    if (partial.rate     !== undefined) arp.setRate(partial.rate);
    if (partial.gate     !== undefined) arp.setGate(partial.gate);
    if (partial.octaves  !== undefined) arp.setOctaves(partial.octaves);
    if (partial.enabled  !== undefined) {
      arp.enabled = partial.enabled;
      if (!partial.enabled) arp.stop();
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {/* Enable toggle */}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:9, fontWeight:600, letterSpacing:'.15em', color:'var(--acc)', textTransform:'uppercase' }}>Arpeggiator</span>
        <div style={{ flex:1 }}/>
        <button onClick={() => update({ enabled: !state.enabled })}
          style={{ width:44, height:24, borderRadius:12, border:'none', cursor:'pointer',
            background: state.enabled ? 'var(--acc)33' : 'var(--bord)', position:'relative', transition:'background .15s' }}>
          <div style={{ position:'absolute', top:3, left: state.enabled ? 20 : 3, width:18, height:18,
            borderRadius:'50%', background: state.enabled ? 'var(--acc)' : 'var(--muted)', transition:'left .15s, background .15s' }}/>
        </button>
      </div>

      {/* Pattern */}
      <div>
        <div style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.12em', textTransform:'uppercase', marginBottom:5 }}>Pattern</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4 }}>
          {PATTERNS.map(p => (
            <button key={p.id} onClick={() => update({ pattern: p.id })}
              style={{ padding:'7px 0', borderRadius:3,
                border:`1px solid ${state.pattern===p.id ? 'var(--acc)' : 'var(--bord)'}`,
                background: state.pattern===p.id ? 'var(--acc)22' : 'none',
                color: state.pattern===p.id ? 'var(--acc)' : 'var(--muted)',
                fontFamily:'IBM Plex Mono', fontSize:9, cursor:'pointer' }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Hold mode */}
      <div>
        <div style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.12em', textTransform:'uppercase', marginBottom:5 }}>Hold Mode</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
          {(['hold','latch'] as HoldMode[]).map(m => (
            <button key={m} onClick={() => update({ holdMode: m })}
              style={{ padding:'7px 0', borderRadius:3,
                border:`1px solid ${state.holdMode===m ? 'var(--acc)' : 'var(--bord)'}`,
                background: state.holdMode===m ? 'var(--acc)22' : 'none',
                color: state.holdMode===m ? 'var(--acc)' : 'var(--muted)',
                fontFamily:'IBM Plex Mono', fontSize:9, cursor:'pointer' }}>{m}</button>
          ))}
        </div>
      </div>

      {/* Knobs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
        <Knob value={state.rate} min={0.5} max={20} step={0.1}
          label="rate" display={v => v.toFixed(1)+'Hz'} color="var(--acc)"
          onChange={v => update({ rate: v })} size={48} />
        <Knob value={state.gate} min={0.05} max={0.99} step={0.01}
          label="gate" display={v => Math.round(v*100)+'%'} color="var(--acc)"
          onChange={v => update({ gate: v })} size={48} />
        <Knob value={state.octaves} min={1} max={4} step={1}
          label="octaves" display={v => v+'oct'} color="var(--acc)"
          onChange={v => update({ octaves: v })} size={48} />
      </div>

      <div style={{ fontSize:9, color:'var(--muted)', lineHeight:1.5 }}>
        Play or hold keys to arpeggiate. In <em>latch</em> mode, tap keys to toggle them on/off.
      </div>
    </div>
  );
};
