import React from 'react';
import type { PatchParams, LfoParams, LfoShape, ModSlot, ModDest, ModSource } from '../../engine/Types';
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

const SOURCES: ModSource[] = ['lfo1', 'lfo2'];

const DESTS: { id: ModDest; label: string }[] = [
  { id: 'pitch',        label: 'pitch'    },
  { id: 'amp',          label: 'amp'      },
  { id: 'filter_cutoff',label: 'filt cut' },
  { id: 'filter_res',   label: 'filt res' },
  { id: 'op1_level',    label: 'op1 lvl'  },
  { id: 'op2_level',    label: 'op2 lvl'  },
  { id: 'op3_level',    label: 'op3 lvl'  },
  { id: 'op4_level',    label: 'op4 lvl'  },
  { id: 'op5_level',    label: 'op5 lvl'  },
  { id: 'op6_level',    label: 'op6 lvl'  },
  { id: 'op1_ratio',    label: 'op1 frq'  },
  { id: 'op2_ratio',    label: 'op2 frq'  },
  { id: 'op3_ratio',    label: 'op3 frq'  },
  { id: 'op4_ratio',    label: 'op4 frq'  },
  { id: 'op5_ratio',    label: 'op5 frq'  },
  { id: 'op6_ratio',    label: 'op6 frq'  },
];

const selectStyle: React.CSSProperties = {
  background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 3,
  color: 'var(--fg)', fontFamily: 'IBM Plex Mono', fontSize: 10,
  padding: '4px 5px', cursor: 'pointer', outline: 'none',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 8, color: 'var(--muted)', letterSpacing: '.12em',
  textTransform: 'uppercase', marginBottom: 6,
};

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

  const updateMatrix = (matrix: ModSlot[]) => {
    logger.info(`modMatrix update slots=${matrix.length}`);
    onChange({ modMatrix: matrix });
  };

  const addSlot = () => {
    updateMatrix([...patch.modMatrix, { source: 'lfo1', dest: 'pitch', amount: 0.3, enabled: true }]);
  };

  const deleteSlot = (i: number) => {
    updateMatrix(patch.modMatrix.filter((_, idx) => idx !== i));
  };

  const updateSlot = (i: number, partial: Partial<ModSlot>) => {
    const matrix = patch.modMatrix.map((s, idx) => idx === i ? { ...s, ...partial } : s);
    updateMatrix(matrix);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <LfoSection label="LFO 1" params={patch.lfo1} onChange={updateLfo1} />

      <div style={{ borderTop: '1px solid var(--bord)' }} />

      <LfoSection label="LFO 2" params={patch.lfo2} onChange={updateLfo2} />

      <div style={{ borderTop: '1px solid var(--bord)' }} />

      {/* Mod Matrix */}
      <div>
        <div style={sectionLabel}>Mod Matrix</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {patch.modMatrix.map((slot, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4,
              background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 4, padding: '6px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select value={slot.source} style={selectStyle}
                  onChange={e => updateSlot(i, { source: e.target.value as ModSource })}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span style={{ color: 'var(--muted)', fontSize: 10 }}>→</span>
                <select value={slot.dest} style={{ ...selectStyle, flex: 1 }}
                  onChange={e => updateSlot(i, { dest: e.target.value as ModDest })}>
                  {DESTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Knob value={slot.amount} min={-1} max={1} step={0.01}
                  label="amount" display={v => (v >= 0 ? '+' : '') + v.toFixed(2)} color="var(--acc)"
                  onChange={v => updateSlot(i, { amount: v })} size={40} />
                <div style={{ flex: 1 }} />
                <button onClick={() => updateSlot(i, { enabled: !slot.enabled })}
                  style={{ padding: '4px 10px', borderRadius: 3, cursor: 'pointer', fontFamily: 'IBM Plex Mono', fontSize: 9,
                    border: `1px solid ${slot.enabled ? 'var(--acc)' : 'var(--bord)'}`,
                    background: slot.enabled ? 'var(--acc)22' : 'none',
                    color: slot.enabled ? 'var(--acc)' : 'var(--muted)' }}>
                  {slot.enabled ? 'on' : 'off'}
                </button>
                <button onClick={() => deleteSlot(i)}
                  style={{ background: 'none', border: '1px solid var(--bord)', borderRadius: 3,
                    color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '2px 8px' }}>×</button>
              </div>
            </div>
          ))}
          <button onClick={addSlot}
            style={{ padding: '7px 0', borderRadius: 3, border: '1px dashed var(--bord)',
              background: 'none', color: 'var(--muted)', fontFamily: 'IBM Plex Mono', fontSize: 10, cursor: 'pointer' }}>
            + add slot
          </button>
        </div>
      </div>

      <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5 }}>
        LFOs restart on each note. Add mod slots to route LFO1/LFO2 to a destination.
        Depth scales the LFO amplitude; amount sets polarity and strength per slot.
      </div>
    </div>
  );
};
