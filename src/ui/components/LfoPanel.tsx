import React from 'react';
import type { PatchParams, LfoParams, LfoShape } from '../../engine/Types';
import { Knob } from './Knob';
import { logger } from '../../debug/Logger';

interface Props {
  patch: PatchParams;
  onChange: (p: Partial<PatchParams>) => void;
}

const SHAPES: { id: LfoShape; label: string }[] = [
  { id: 'sine',     label: 'sin' },
  { id: 'triangle', label: 'tri' },
  { id: 'sawtooth', label: 'saw' },
  { id: 'square',   label: 'sq'  },
  { id: 'random',   label: 'rnd' },
];

function LfoSection({ label, params, onChange }: {
  label: string;
  params: LfoParams;
  onChange: (p: Partial<LfoParams>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.15em', color: 'var(--acc)', textTransform: 'uppercase' }}>{label}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 8, color: 'var(--muted)', marginRight: 4 }}>sync</span>
        <button onClick={() => onChange({ sync: !params.sync })}
          style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: params.sync ? 'var(--acc)33' : 'var(--bord)', position: 'relative', transition: 'background .15s' }}>
          <div style={{ position: 'absolute', top: 2, left: params.sync ? 16 : 2, width: 16, height: 16,
            borderRadius: '50%', background: params.sync ? 'var(--acc)' : 'var(--muted)', transition: 'left .15s, background .15s' }} />
        </button>
      </div>

      {/* Shape */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 3 }}>
        {SHAPES.map(s => (
          <button key={s.id} onClick={() => onChange({ shape: s.id })}
            style={{ padding: '5px 0', borderRadius: 3, fontFamily: 'IBM Plex Mono', fontSize: 9, cursor: 'pointer',
              border: `1px solid ${params.shape === s.id ? 'var(--acc)' : 'var(--bord)'}`,
              background: params.shape === s.id ? 'var(--acc)22' : 'none',
              color: params.shape === s.id ? 'var(--acc)' : 'var(--muted)' }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Knobs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <Knob value={params.rate} min={0.01} max={20} step={0.01}
          label="rate" display={v => v.toFixed(2) + 'Hz'} color="var(--acc)"
          onChange={v => onChange({ rate: v })} size={48} />
        <Knob value={params.depth} min={0} max={1} step={0.01}
          label="depth" display={v => Math.round(v * 100) + '%'} color="var(--acc)"
          onChange={v => onChange({ depth: v })} size={48} />
        <Knob value={params.delay} min={0} max={4} step={0.01}
          label="delay" display={v => v.toFixed(2) + 's'} color="var(--acc)"
          onChange={v => onChange({ delay: v })} size={48} />
      </div>
    </div>
  );
}

export const LfoPanel: React.FC<Props> = ({ patch, onChange }) => {
  const updateLfo1 = (p: Partial<LfoParams>) => {
    const lfo1 = { ...patch.lfo1, ...p };
    logger.info(`lfo1 update shape=${lfo1.shape} rate=${lfo1.rate.toFixed(2)} depth=${lfo1.depth.toFixed(2)} delay=${lfo1.delay.toFixed(2)}`);
    onChange({ lfo1 });
  };

  const updateLfo2 = (p: Partial<LfoParams>) => {
    const lfo2 = { ...patch.lfo2, ...p };
    logger.info(`lfo2 update shape=${lfo2.shape} rate=${lfo2.rate.toFixed(2)} depth=${lfo2.depth.toFixed(2)} delay=${lfo2.delay.toFixed(2)}`);
    onChange({ lfo2 });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <LfoSection label="LFO 1" params={patch.lfo1} onChange={updateLfo1} />

      <div style={{ borderTop: '1px solid var(--bord)' }} />

      <LfoSection label="LFO 2" params={patch.lfo2} onChange={updateLfo2} />

      <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        LFOs restart on each note. Route them to parameters in the Mod tab.
      </div>
    </div>
  );
};
