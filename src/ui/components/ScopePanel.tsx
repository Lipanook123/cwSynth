import { useState } from 'react';
import { Scope } from './Scope';
import { engine } from '../../engine/AudioEngine';

export function ScopePanel() {
  const [frozen, setFrozen] = useState(false);

  const analyser = engine.getAnalyser();
  const sr       = analyser?.context.sampleRate ?? 44100;
  const fftSize  = analyser?.fftSize ?? 2048;
  const windowMs = ((fftSize / sr) * 1000).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 8, letterSpacing: '.15em', textTransform: 'uppercase',
          color: 'var(--acc)', fontFamily: 'IBM Plex Mono' }}>Oscilloscope</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 8, color: 'var(--muted)', fontFamily: 'IBM Plex Mono' }}>
          {windowMs} ms window
        </span>
        <button
          onClick={() => setFrozen(f => !f)}
          style={{ padding: '3px 10px', borderRadius: 3, fontFamily: 'IBM Plex Mono', fontSize: 9,
            cursor: 'pointer',
            border: `1px solid ${frozen ? 'var(--acc)' : 'var(--bord)'}`,
            background: frozen ? 'var(--acc)22' : 'none',
            color: frozen ? 'var(--acc)' : 'var(--muted)' }}>
          {frozen ? 'frozen' : 'freeze'}
        </button>
      </div>

      {/* Canvas fills remaining height */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Scope stable showGrid frozen={frozen} />
      </div>
    </div>
  );
}
