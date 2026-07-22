import React, { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '../../debug/Logger';

export const LogViewer: React.FC = () => {
  const [open, setOpen]   = useState(false);
  const [, tick]          = useState(0);
  const [filter, setFilter] = useState<string>('');
  const bottomRef         = useRef<HTMLDivElement>(null);

  useEffect(() => logger.onUpdate(() => tick(n => n + 1)), []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, tick]);

  const entries = logger.getEntries();
  const visible = filter
    ? entries.filter(e => e.msg.toLowerCase().includes(filter.toLowerCase()) || e.level.includes(filter.toLowerCase()))
    : entries;

  const levelColor = (l: string) => {
    if (l === 'error') return '#ff4a6b';
    if (l === 'warn')  return '#ffaa4a';
    if (l === 'info')  return '#4a9eff';
    return 'var(--fg)';
  };

  const errCount = entries.filter(e => e.level === 'error').length;
  const warnCount = entries.filter(e => e.level === 'warn').length;

  const onDownload = useCallback(() => logger.download(), []);
  const onClear    = useCallback(() => logger.clear(), []);

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 120, right: 10, zIndex: 900,
          width: 36, height: 36, borderRadius: '50%',
          background: errCount > 0 ? '#ff4a6b33' : warnCount > 0 ? '#ffaa4a33' : 'var(--surf2)',
          border: `1px solid ${errCount > 0 ? '#ff4a6b' : warnCount > 0 ? '#ffaa4a' : 'var(--bord2)'}`,
          color: errCount > 0 ? '#ff4a6b' : warnCount > 0 ? '#ffaa4a' : 'var(--muted)',
          fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px #0006',
        }}
        title="Debug log"
      >
        {errCount > 0 ? '⚠' : '🐛'}
      </button>

      {/* Log panel overlay */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg)', borderTop: '1px solid var(--bord)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', background: 'var(--surf)',
            borderBottom: '1px solid var(--bord)', flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--acc)', fontWeight: 600, letterSpacing: '.1em' }}>
              DEBUG LOG
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: 'var(--muted)' }}>
              {entries.length} entries
              {errCount > 0 && <span style={{ color: '#ff4a6b' }}> · {errCount} err</span>}
              {warnCount > 0 && <span style={{ color: '#ffaa4a' }}> · {warnCount} warn</span>}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={onDownload} style={btnStyle('#4a9eff')}>⬇ download</button>
            <button onClick={onClear}    style={btnStyle('var(--muted)')}>✕ clear</button>
            <button onClick={() => setOpen(false)} style={btnStyle('var(--muted)')}>✕ close</button>
          </div>

          {/* Filter */}
          <div style={{ padding: '6px 12px', background: 'var(--surf)', borderBottom: '1px solid var(--bord)', flexShrink: 0 }}>
            <input
              placeholder="filter…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                width: '100%', background: 'var(--surf2)', border: '1px solid var(--bord2)',
                borderRadius: 4, padding: '5px 8px', color: 'var(--fg)',
                fontFamily: 'IBM Plex Mono', fontSize: 10, outline: 'none',
              }}
            />
          </div>

          {/* Entries */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', fontFamily: 'IBM Plex Mono', fontSize: 10 }}>
            {visible.length === 0 && (
              <div style={{ padding: '20px', color: 'var(--muted)', textAlign: 'center' }}>no entries</div>
            )}
            {visible.map((e, i) => (
              <div key={i} style={{
                padding: '2px 12px', borderBottom: '1px solid var(--bord)',
                display: 'grid', gridTemplateColumns: '70px 42px 1fr', gap: 6,
                background: e.level === 'error' ? '#ff4a6b08' : e.level === 'warn' ? '#ffaa4a08' : 'transparent',
              }}>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>+{e.t}ms</span>
                <span style={{ color: levelColor(e.level), textTransform: 'uppercase' }}>{e.level}</span>
                <span style={{ color: levelColor(e.level), wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{e.msg}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
};

const btnStyle = (color: string): React.CSSProperties => ({
  background: 'none', border: `1px solid ${color}55`, borderRadius: 4,
  color, fontFamily: 'IBM Plex Mono', fontSize: 9, padding: '4px 8px',
  cursor: 'pointer', whiteSpace: 'nowrap',
});
