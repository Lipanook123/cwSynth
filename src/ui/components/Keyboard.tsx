import { useRef, useCallback, useState, useEffect } from 'react';
import { engine } from '../../engine/AudioEngine';

const OCTAVES    = 8;
const START_MIDI = 12; // C0

interface KeyDef { semi: number; note: string; isSharp: boolean; }

function buildKeys(): KeyDef[] {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const keys: KeyDef[] = [];
  for (let i = 0; i < OCTAVES * 12 + 1; i++) {
    const n = i % 12;
    keys.push({ semi: START_MIDI + i, note: names[n] + Math.floor((START_MIDI + i) / 12 - 1), isSharp: [1,3,6,8,10].includes(n) });
  }
  return keys;
}

const KEYS = buildKeys();
const NAT  = KEYS.filter(k => !k.isSharp);
const NW = 36, SW = 22, NH = 90, SH = 56, GAP = 1;

function buildPositions() {
  const pos: Record<number, { x: number; w: number; h: number; z: number }> = {};
  let x = 0;
  for (const k of NAT) {
    pos[k.semi] = { x, w: NW, h: NH, z: 1 };
    x += NW + GAP;
  }
  for (const k of KEYS.filter(k => k.isSharp)) {
    const li = NAT.findIndex(n => n.semi > k.semi) - 1;
    if (li < 0) continue;
    const lx = pos[NAT[li].semi].x;
    pos[k.semi] = { x: lx + NW + GAP / 2 - SW / 2, w: SW, h: SH, z: 2 };
  }
  return { pos, totalW: NAT.length * (NW + GAP) };
}

const { pos, totalW } = buildPositions();

export function Keyboard() {
  const held        = useRef(new Set<number>());
  const ptrMap      = useRef(new Map<number, number>());
  const dragInfoMap = useRef(new Map<number, { startX: number; startScroll: number }>());
  const scrollRef   = useRef<HTMLDivElement>(null);
  const [activeNotes, setActiveNotes] = useState<ReadonlySet<number>>(new Set());
  const [slideLock, setSlideLock] = useState(false);
  const slideLockRef = useRef(slideLock);
  slideLockRef.current = slideLock;

  useEffect(() => engine.addNoteListener(() => setActiveNotes(engine.getActiveNotes())), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const midCX = pos[60]?.x ?? 0;
    el.scrollLeft = midCX - el.clientWidth / 2 + NW / 2;
  }, []);

  const on  = useCallback((semi: number) => { if (held.current.has(semi)) return; held.current.add(semi); engine.noteOn(semi); }, []);
  const off = useCallback((semi: number) => { held.current.delete(semi); engine.noteOff(semi); }, []);

  const onPtrDown = useCallback((semi: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    ptrMap.current.set(e.pointerId, semi);
    dragInfoMap.current.set(e.pointerId, {
      startX: e.clientX,
      startScroll: scrollRef.current?.scrollLeft ?? 0,
    });
    on(semi);
  }, [on]);

  const onPtrMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptrMap.current.has(e.pointerId)) return;
    if (slideLockRef.current) {
      // Slide mode: glide between notes
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const semiStr = el?.closest('[data-semi]')?.getAttribute('data-semi');
      if (!semiStr) return;
      const newSemi = parseInt(semiStr);
      const oldSemi = ptrMap.current.get(e.pointerId);
      if (oldSemi !== newSemi) {
        if (oldSemi != null) off(oldSemi);
        on(newSemi);
        ptrMap.current.set(e.pointerId, newSemi);
      }
    } else {
      // Scroll mode: drag to pan through octaves
      const drag = dragInfoMap.current.get(e.pointerId);
      if (!drag || !scrollRef.current) return;
      scrollRef.current.scrollLeft = drag.startScroll - (e.clientX - drag.startX);
    }
  }, [on, off]);

  const onPtrUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = ptrMap.current.get(e.pointerId);
    if (s != null) { off(s); ptrMap.current.delete(e.pointerId); }
    dragInfoMap.current.delete(e.pointerId);
  }, [off]);

  return (
    <div style={{ flexShrink: 0, borderTop: '2px solid var(--bord)' }}>
      {/* Slide lock strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '4px 10px', background: 'var(--surf)', borderBottom: '1px solid var(--bord)' }}>
        <span style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.1em',
          textTransform: 'uppercase', marginRight: 6 }}>slide</span>
        <button onClick={() => setSlideLock(s => !s)}
          style={{ padding: '3px 10px', borderRadius: 3, fontFamily: 'IBM Plex Mono', fontSize: 9,
            cursor: 'pointer',
            border: `1px solid ${slideLock ? 'var(--acc)' : 'var(--bord)'}`,
            background: slideLock ? 'var(--acc)22' : 'none',
            color: slideLock ? 'var(--acc)' : 'var(--muted)' }}>
          {slideLock ? 'on' : 'off'}
        </button>
      </div>

      {/* Keys */}
      <div
        ref={scrollRef}
        style={{ height: NH + 16, background: 'var(--bg)', overflowX: 'auto', overflowY: 'hidden',
          touchAction: 'pan-x', scrollbarWidth: 'none' }}
      >
        <div style={{ position: 'relative', width: totalW, height: NH + 16, paddingTop: 8 }}>
          {KEYS.map(k => {
            const p = pos[k.semi];
            if (!p) return null;
            const active = activeNotes.has(k.semi);
            return (
              <div
                key={k.semi}
                data-semi={k.semi}
                onPointerDown={e => onPtrDown(k.semi, e)}
                onPointerMove={onPtrMove}
                onPointerUp={onPtrUp}
                onPointerCancel={onPtrUp}
                style={{
                  position: 'absolute', left: p.x, top: 0, width: p.w, height: p.h, zIndex: p.z,
                  borderRadius: '0 0 4px 4px', cursor: 'pointer', userSelect: 'none',
                  touchAction: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  background: active
                    ? k.isSharp ? 'var(--acc)' : 'var(--acc)99'
                    : k.isSharp ? 'var(--key-shp-bg)' : 'var(--key-nat-bg)',
                  border: active
                    ? '1px solid var(--acc)'
                    : k.isSharp ? '1px solid var(--key-shp-bord)' : '1px solid var(--key-nat-bord)',
                  transition: 'background .06s, border-color .06s',
                }}
              >
                {!k.isSharp && (
                  <span style={{
                    position: 'absolute', bottom: 6, left: 0, right: 0,
                    textAlign: 'center', fontSize: 8, color: 'var(--key-label)',
                    fontFamily: 'IBM Plex Mono', pointerEvents: 'none',
                  }}>{k.note}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
