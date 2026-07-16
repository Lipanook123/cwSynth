import React, { useState } from 'react';
import { RandomMode, generateSeed } from '../../engine/Randomiser';

interface Props {
  mode: RandomMode;
  seed: string;
  onModeChange: (m: RandomMode) => void;
  onSeedChange: (s: string) => void;
  onRandomise: (seed: string, mode: RandomMode) => void;
  label?: string;           // e.g. "Operators", "FX" — shown in button
  compact?: boolean;        // just the dice button, no seed input
  color?: string;
}

export const RandomControls: React.FC<Props> = ({
  mode, seed, onModeChange, onSeedChange, onRandomise, label, compact = false, color = 'var(--acc)',
}) => {
  const [editing, setEditing] = useState(false);

  const roll = () => {
    const s = String(generateSeed());
    onSeedChange(s);
    onRandomise(s, mode);
  };

  const fire = () => onRandomise(seed, mode);

  if (compact) {
    return (
      <button onClick={roll} title={`Randomise ${label ?? ''} (${mode})`}
        style={{
          background: 'none', border: `1px solid ${color}66`,
          borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
          color, fontSize: 13, lineHeight: 1, transition: 'border-color .1s, background .1s',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = color + '22')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        🎲{label && <span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</span>}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {/* Wild / Safe toggle */}
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--bord)', flexShrink: 0 }}>
        {(['safe', 'wild'] as RandomMode[]).map(m => (
          <button key={m} onClick={() => onModeChange(m)}
            style={{
              padding: '5px 10px', border: 'none', cursor: 'pointer',
              background: mode === m ? (m === 'wild' ? 'var(--red)33' : 'var(--acc)22') : 'none',
              color: mode === m ? (m === 'wild' ? 'var(--red)' : 'var(--acc)') : 'var(--muted)',
              fontFamily: 'IBM Plex Mono', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase',
              transition: 'all .12s',
            }}>{m === 'wild' ? '🔥 wild' : '✓ safe'}</button>
        ))}
      </div>

      {/* Seed input */}
      {editing ? (
        <input
          value={seed} autoFocus
          onChange={e => onSeedChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); fire(); } if (e.key === 'Escape') setEditing(false); }}
          style={{
            width: 90, background: 'var(--surf)', border: '1px solid var(--acc)',
            borderRadius: 4, padding: '5px 8px', color: 'var(--fg)',
            fontFamily: 'IBM Plex Mono', fontSize: 10, outline: 'none',
          }}
        />
      ) : (
        <button onClick={() => setEditing(true)} title="Click to enter seed"
          style={{
            background: 'var(--surf)', border: '1px solid var(--bord)', borderRadius: 4,
            padding: '5px 8px', color: 'var(--muted)', fontFamily: 'IBM Plex Mono',
            fontSize: 10, cursor: 'text', minWidth: 70, textAlign: 'left',
          }}>
          #{seed || '—'}
        </button>
      )}

      {/* Roll new seed */}
      <button onClick={() => { const s = String(generateSeed()); onSeedChange(s); onRandomise(s, mode); }}
        title="Generate new seed and randomise"
        style={{
          background: color + '22', border: `1px solid ${color}66`, borderRadius: 4,
          padding: '5px 10px', color, fontFamily: 'IBM Plex Mono', fontSize: 11,
          cursor: 'pointer', transition: 'background .1s', display: 'flex', alignItems: 'center', gap: 5,
        }}>
        🎲{label ? <span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</span> : null}
      </button>

      {/* Re-run current seed */}
      {seed && (
        <button onClick={fire} title={`Re-run seed #${seed}`}
          style={{
            background: 'none', border: '1px solid var(--bord)', borderRadius: 4,
            padding: '5px 8px', color: 'var(--muted)', fontFamily: 'IBM Plex Mono',
            fontSize: 9, cursor: 'pointer', letterSpacing: '.06em',
          }}>↺ re-run</button>
      )}
    </div>
  );
};
