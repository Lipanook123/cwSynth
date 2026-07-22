import React, { useRef, useCallback, useState, useEffect } from 'react';
import { engine } from '../../engine/AudioEngine';

const OCTAVES = 3;
const START_MIDI = 48; // C3

interface KeyDef { semi: number; note: string; isSharp: boolean; }

function buildKeys(): KeyDef[] {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const keys: KeyDef[] = [];
  for (let i = 0; i < OCTAVES * 12 + 1; i++) {
    const n = (i % 12);
    keys.push({ semi: START_MIDI + i, note: names[n] + Math.floor((START_MIDI + i) / 12 - 1), isSharp: [1,3,6,8,10].includes(n) });
  }
  return keys;
}

const KEYS = buildKeys();
const NAT  = KEYS.filter(k => !k.isSharp);
const NW   = 36, SW = 22, NH = 90, SH = 56, GAP = 1;

function buildPositions() {
  const pos: Record<number, { x: number; w: number; h: number; z: number }> = {};
  let x = 0;
  for (const k of NAT) {
    pos[k.semi] = { x, w: NW, h: NH, z: 1 };
    x += NW + GAP;
  }
  const sharps = KEYS.filter(k => k.isSharp);
  for (const k of sharps) {
    // find left and right naturals
    const li = NAT.findIndex(n => n.semi > k.semi) - 1;
    if (li < 0) continue;
    const lx = pos[NAT[li].semi].x;
    pos[k.semi] = { x: lx + NW + GAP / 2 - SW / 2, w: SW, h: SH, z: 2 };
  }
  return { pos, totalW: (NAT.length) * (NW + GAP) };
}

const { pos, totalW } = buildPositions();

export const Keyboard: React.FC = () => {
  const held        = useRef(new Set<number>());
  const touchMap    = useRef(new Map<number, number>());
  const lastTouch   = useRef(new Map<number, number>()); // semi → timestamp of last touchStart
  const [activeNotes, setActiveNotes] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    return engine.addNoteListener(() => setActiveNotes(engine.getActiveNotes()));
  }, []);

  const on  = useCallback((semi: number) => { if (held.current.has(semi)) return; held.current.add(semi); engine.noteOn(semi); }, []);
  const off = useCallback((semi: number) => { held.current.delete(semi); engine.noteOff(semi); }, []);


  return (
    <div style={{
      flexShrink: 0, height: NH + 16, background: '#06080c',
      borderTop: '2px solid var(--bord)', overflowX: 'auto', overflowY: 'hidden',
      touchAction: 'pan-x', scrollbarWidth: 'none',
    }}>
      <div style={{ position: 'relative', width: totalW, height: NH + 16, paddingTop: 8 }}>
        {KEYS.map(k => {
          const p = pos[k.semi];
          if (!p) return null;
          return (
            <div
              key={k.semi}
              data-semi={k.semi}
              className={activeNotes.has(k.semi) ? 'key-active' : undefined}
              onMouseDown={e => {
                // Suppress synthetic mouse events fired by the browser after touchEnd
                if (Date.now() - (lastTouch.current.get(k.semi) ?? 0) < 500) return;
                e.preventDefault(); on(k.semi);
              }}
              onMouseEnter={e => { if (e.buttons === 1) on(k.semi); }}
              onMouseUp={() => off(k.semi)}
              onMouseLeave={() => off(k.semi)}
              onTouchStart={e => {
                e.preventDefault();
                Array.from(e.changedTouches).forEach(t => {
                  lastTouch.current.set(k.semi, Date.now());
                  touchMap.current.set(t.identifier, k.semi);
                  on(k.semi);
                });
              }}
              onTouchEnd={e => {
                Array.from(e.changedTouches).forEach(t => {
                  const s = touchMap.current.get(t.identifier);
                  if (s != null) { off(s); touchMap.current.delete(t.identifier); }
                });
              }}
              onTouchCancel={e => {
                Array.from(e.changedTouches).forEach(t => {
                  const s = touchMap.current.get(t.identifier);
                  if (s != null) { off(s); touchMap.current.delete(t.identifier); }
                });
              }}
              style={{
                position: 'absolute',
                left: p.x, top: 0, width: p.w, height: p.h,
                zIndex: p.z,
                borderRadius: '0 0 4px 4px',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                background: activeNotes.has(k.semi)
                  ? k.isSharp ? 'var(--acc)' : 'var(--acc)99'
                  : k.isSharp
                    ? 'linear-gradient(180deg, #0e1018 0%, #0a0c14 100%)'
                    : 'linear-gradient(180deg, #1a1e2c 0%, #131621 100%)',
                border: activeNotes.has(k.semi)
                  ? '1px solid var(--acc)'
                  : k.isSharp ? '1px solid #0c0e16' : '1px solid #232840',
                transition: 'background .06s, border-color .06s',
              }}
            >
              {!k.isSharp && (
                <span style={{
                  position: 'absolute', bottom: 6, left: 0, right: 0,
                  textAlign: 'center', fontSize: 8, color: '#2a3450',
                  fontFamily: 'IBM Plex Mono', pointerEvents: 'none',
                }}>{k.note}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
