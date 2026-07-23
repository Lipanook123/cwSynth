import { useState } from 'react';
import type { PatchParams, ModSlot, ModDest, ModSource } from '../../engine/Types';
import { Knob } from './Knob';
import { logger } from '../../debug/Logger';

interface Props {
  patch: PatchParams;
  onChange: (p: Partial<PatchParams>) => void;
}

// Active sources (wired in engine)
const ACTIVE_SOURCES: ModSource[] = ['lfo1', 'lfo2'];
// Coming-soon sources
const SOON_SOURCES: ModSource[] = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'velocity', 'mod'];

// Non-operator destinations
const DIRECT_DESTS: { id: ModDest; label: string }[] = [
  { id: 'pitch',        label: 'pitch'      },
  { id: 'amp',          label: 'amp'         },
  { id: 'filter_cutoff',label: 'filt cut'   },
  { id: 'filter_res',   label: 'filt res'   },
  { id: 'fx_reverb',    label: 'fx reverb'  },
  { id: 'fx_delay',     label: 'fx delay'   },
  { id: 'fx_chorus',    label: 'fx chorus'  },
];

const OP_PROPS: { key: 'level' | 'ratio'; label: string }[] = [
  { key: 'level', label: 'level' },
  { key: 'ratio', label: 'freq'  },
];

function destLabel(dest: ModDest): string {
  const opLvl = dest.match(/^op(\d)_level$/);
  if (opLvl) return `op ${opLvl[1]} › level`;
  const opRat = dest.match(/^op(\d)_ratio$/);
  if (opRat) return `op ${opRat[1]} › freq`;
  return DIRECT_DESTS.find(d => d.id === dest)?.label ?? dest;
}

type AddStep =
  | { phase: 'closed' }
  | { phase: 'pick-category'; forDest?: ModDest }   // top-level: direct dests + op1-6
  | { phase: 'pick-op-prop'; opNum: number };        // level vs freq for chosen op

type AddSourceStep =
  | { phase: 'closed' }
  | { phase: 'open'; forDest: ModDest };

const chip: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 3, fontFamily: 'IBM Plex Mono', fontSize: 9,
  cursor: 'pointer', border: '1px solid var(--bord)', background: 'none',
  color: 'var(--muted)',
};
const chipActive: React.CSSProperties = {
  ...chip, border: '1px solid var(--acc)', background: 'var(--acc)22', color: 'var(--acc)',
};

export function ModMatrix({ patch, onChange }: Props) {
  const [addDest, setAddDest] = useState<AddStep>({ phase: 'closed' });
  const [addSrc, setAddSrc] = useState<AddSourceStep>({ phase: 'closed' });

  const matrix = patch.modMatrix;

  const push = (updated: ModSlot[]) => {
    logger.info(`modMatrix update slots=${updated.length}`);
    onChange({ modMatrix: updated });
  };

  const deleteSlot = (idx: number) => push(matrix.filter((_, i) => i !== idx));

  const updateSlot = (idx: number, partial: Partial<ModSlot>) =>
    push(matrix.map((s, i) => (i === idx ? { ...s, ...partial } : s)));

  const addSlot = (dest: ModDest, source: ModSource = 'lfo1') => {
    push([...matrix, { source, dest, amount: 0.3, enabled: true }]);
    logger.info(`modMatrix addSlot dest=${dest} source=${source}`);
  };

  // Group by destination, preserving original flat indices
  const grouped = new Map<ModDest, { slot: ModSlot; idx: number }[]>();
  matrix.forEach((slot, idx) => {
    const arr = grouped.get(slot.dest) ?? [];
    arr.push({ slot, idx });
    grouped.set(slot.dest, arr);
  });

  // Which dests are already in matrix (to filter "add dest" list)
  const usedDests = new Set(matrix.map(s => s.dest));

  const handlePickCategory = (dest: ModDest) => {
    addSlot(dest);
    setAddDest({ phase: 'closed' });
  };

  const handlePickOpProp = (opNum: number, prop: 'level' | 'ratio') => {
    const dest = `op${opNum}_${prop}` as ModDest;
    addSlot(dest);
    setAddDest({ phase: 'closed' });
  };

  const handleAddSource = (dest: ModDest, source: ModSource) => {
    addSlot(dest, source);
    setAddSrc({ phase: 'closed' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
        Mod Matrix
      </div>

      {/* Destination cards */}
      {[...grouped.entries()].map(([dest, rows]) => (
        <div key={dest} style={{ background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: 'var(--acc)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            {destLabel(dest)}
          </div>

          {/* Source rows */}
          {rows.map(({ slot, idx }) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: 'var(--fg)', minWidth: 32 }}>
                {slot.source}
              </span>
              <Knob value={slot.amount} min={-1} max={1} step={0.01}
                label="amt" display={v => (v >= 0 ? '+' : '') + v.toFixed(2)} color="var(--acc)"
                onChange={v => updateSlot(idx, { amount: v })} size={40} />
              <div style={{ flex: 1 }} />
              <button
                onClick={() => updateSlot(idx, { enabled: !slot.enabled })}
                style={slot.enabled ? chipActive : chip}>
                {slot.enabled ? 'on' : 'off'}
              </button>
              <button
                onClick={() => deleteSlot(idx)}
                style={{ background: 'none', border: '1px solid var(--bord)', borderRadius: 3,
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '2px 8px', lineHeight: 1 }}>
                ×
              </button>
            </div>
          ))}

          {/* Add source to this dest */}
          {addSrc.phase === 'open' && addSrc.forDest === dest ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {ACTIVE_SOURCES.map(s => (
                <button key={s} style={chip} onClick={() => handleAddSource(dest, s)}>{s}</button>
              ))}
              {SOON_SOURCES.map(s => (
                <button key={s} disabled style={{ ...chip, opacity: 0.35, cursor: 'default' }}>{s} (soon)</button>
              ))}
              <button style={chip} onClick={() => setAddSrc({ phase: 'closed' })}>cancel</button>
            </div>
          ) : (
            <button
              style={{ ...chip, marginTop: 2 }}
              onClick={() => setAddSrc({ phase: 'open', forDest: dest })}>
              + add source
            </button>
          )}
        </div>
      ))}

      {/* Add destination */}
      {addDest.phase === 'closed' && (
        <button
          onClick={() => setAddDest({ phase: 'pick-category' })}
          style={{ padding: '8px 0', borderRadius: 3, border: '1px dashed var(--bord)',
            background: 'none', color: 'var(--muted)', fontFamily: 'IBM Plex Mono', fontSize: 10, cursor: 'pointer' }}>
          + add destination
        </button>
      )}

      {addDest.phase === 'pick-category' && (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Pick destination
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {DIRECT_DESTS.filter(d => !usedDests.has(d.id)).map(d => (
              <button key={d.id} style={chip} onClick={() => handlePickCategory(d.id)}>{d.label}</button>
            ))}
            {[1,2,3,4,5,6].map(n => (
              <button key={n} style={chip} onClick={() => setAddDest({ phase: 'pick-op-prop', opNum: n })}>
                op {n}
              </button>
            ))}
            <button style={chip} onClick={() => setAddDest({ phase: 'closed' })}>cancel</button>
          </div>
        </div>
      )}

      {addDest.phase === 'pick-op-prop' && (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            op {addDest.opNum} › which parameter?
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {OP_PROPS.map(p => (
              <button key={p.key} style={chip}
                onClick={() => handlePickOpProp((addDest as { phase: 'pick-op-prop'; opNum: number }).opNum, p.key)}>
                {p.label}
              </button>
            ))}
            <button style={chip} onClick={() => setAddDest({ phase: 'pick-category' })}>← back</button>
          </div>
        </div>
      )}

      {grouped.size === 0 && addDest.phase === 'closed' && (
        <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.6 }}>
          Add a destination to start routing LFOs to parameters.
        </div>
      )}
    </div>
  );
}
