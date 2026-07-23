import { useState, useEffect, useCallback } from 'react';
import { Scope } from './Scope';
import { engine } from '../../engine/AudioEngine';

export function ScopePanel() {
  const [frozen, setFrozen] = useState(false);

  const toggleFreeze = useCallback(() => setFrozen(f => !f), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'f' || e.key === 'F') toggleFreeze();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleFreeze]);

  const analyser = engine.getAnalyser();
  const sr       = analyser?.context.sampleRate ?? 44100;
  const fftSize  = analyser?.fftSize ?? 2048;
  const windowMs = ((fftSize / sr) * 1000).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 8, letterSpacing: '.15em', textTransform: 'uppercase',
          color: 'var(--acc)', fontFamily: 'IBM Plex Mono' }}>Oscilloscope</span>
        <div style={{ flex: 1 }} />
        {frozen && (
          <span style={{ fontSize: 8, letterSpacing: '.12em', textTransform: 'uppercase',
            color: 'var(--acc)', fontFamily: 'IBM Plex Mono' }}>[frozen]</span>
        )}
        <span style={{ fontSize: 8, color: 'var(--muted)', fontFamily: 'IBM Plex Mono' }}>
          {windowMs} ms · tap canvas or F to freeze
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Scope stable showGrid frozen={frozen} onToggleFreeze={toggleFreeze} />
      </div>
    </div>
  );
}
