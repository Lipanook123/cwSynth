import { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { engine } from '../../engine/AudioEngine';
import type { ScopeSource } from '../../engine/AudioEngine';
import { Knob } from './Knob';

const TIME_DIVS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20]; // ms/div
const V_DIVS    = [0.05, 0.1, 0.2, 0.5, 1.0, 2.0];   // amplitude/div
const H_DIVS    = 6;
const V_DIVS_N  = 8;

type TrigMode = 'auto' | 'normal' | 'single';
type TrigEdge = 'rise' | 'fall';
type Coupling = 'AC' | 'DC';

interface Meas { freq: number; vpp: number; rms: number; }

function nextPow2(n: number): number {
  let p = 1024;
  while (p < n && p < 32768) p <<= 1;
  return p;
}

function computeMeasurements(slice: Float32Array, sr: number): Meas {
  let max = -Infinity, min = Infinity, sumSq = 0;
  for (const s of slice) {
    if (s > max) max = s;
    if (s < min) min = s;
    sumSq += s * s;
  }
  const vpp = max - min;
  const rms = Math.sqrt(sumSq / slice.length);
  let prev = -1, freq = 0;
  for (let i = 1; i < slice.length - 1; i++) {
    if (slice[i - 1] <= 0 && slice[i] > 0) {
      if (prev >= 0) { freq = sr / (i - prev); break; }
      prev = i;
    }
  }
  return { freq, vpp, rms };
}

function findTriggerPoint(buf: Float32Array, level: number, edge: TrigEdge): number {
  const mid   = Math.floor(buf.length / 2);
  const range = Math.floor(buf.length / 4);
  for (let i = mid - range; i < mid + range - 1; i++) {
    if (edge === 'rise' && buf[i] <= level && buf[i + 1] > level) return i;
    if (edge === 'fall' && buf[i] >= level && buf[i + 1] < level) return i;
  }
  return -1;
}

export function ScopePanel() {
  const [timeDivIdx, setTimeDivIdx] = useState(3);      // 1 ms/div
  const [vDivIdx,    setVDivIdx]    = useState(3);      // 0.5 V/div
  const [yPos,       setYPos]       = useState(0);      // div offset −4..+4
  const [coupling,   setCoupling]   = useState<Coupling>('DC');
  const [trigLevel,  setTrigLevel]  = useState(0);
  const [trigEdge,   setTrigEdge]   = useState<TrigEdge>('rise');
  const [trigMode,   setTrigMode]   = useState<TrigMode>('auto');
  const [frozen,     setFrozen]     = useState(false);
  const [source,     setSource]     = useState<ScopeSource>('master');
  const [meas,       setMeas]       = useState<Meas>({ freq: 0, vpp: 0, rms: 0 });

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const singleArmed  = useRef(true);
  const frameCount   = useRef(0);

  // All render-loop state in one ref to avoid stale closures
  const live = useRef({ timeDivIdx, vDivIdx, yPos, coupling, trigLevel, trigEdge, trigMode, frozen, source });
  live.current = { timeDivIdx, vDivIdx, yPos, coupling, trigLevel, trigEdge, trigMode, frozen, source };

  const toggleFreeze = useCallback(() => setFrozen(f => !f), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'f' || e.key === 'F') toggleFreeze();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleFreeze]);

  // Keep engine in sync so the topbar scope mirrors the selected source
  useEffect(() => { engine.setScopeSource(source); }, [source]);

  // Re-arm single trigger
  const activateSingle = useCallback(() => {
    singleArmed.current = true;
    setFrozen(false);
    setTrigMode('single');
  }, []);

  // Resize all analyser buffers when timebase changes
  useEffect(() => {
    const analyser = engine.getAnalyser();
    if (!analyser) return;
    const sr = analyser.context.sampleRate;
    const needed = Math.ceil(TIME_DIVS[timeDivIdx] * H_DIVS * sr / 1000);
    engine.setAllFftSizes(nextPow2(needed));
  }, [timeDivIdx]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Render loop — runs once, reads all state via live ref
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const { timeDivIdx, vDivIdx, yPos, coupling, trigLevel, trigEdge, trigMode, frozen, source } = live.current;
      if (frozen) return;

      const analyser = engine.getAnalyserFor(source);
      if (!analyser) return;

      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);

      if (coupling === 'AC') {
        let sum = 0;
        for (const s of buf) sum += s;
        const mean = sum / buf.length;
        for (let i = 0; i < buf.length; i++) buf[i] -= mean;
      }

      const trig = findTriggerPoint(buf, trigLevel, trigEdge);
      if (trig < 0) {
        if (trigMode === 'normal' || trigMode === 'single') return;
      } else if (trigMode === 'single' && singleArmed.current) {
        singleArmed.current = false;
        setTimeout(() => setFrozen(true), 0);
      }
      const start = trig >= 0 ? trig : 0;

      const w = canvas.width, h = canvas.height;
      const style = getComputedStyle(canvas);
      const bg    = style.getPropertyValue('--bg').trim()    || '#06080c';
      const bord  = style.getPropertyValue('--bord').trim()  || '#1e2535';
      const bord2 = style.getPropertyValue('--bord2').trim() || '#2a3450';
      const acc   = style.getPropertyValue('--acc').trim()   || '#4af0a0';
      const muted = style.getPropertyValue('--muted').trim() || '#4a5880';

      const dpr    = devicePixelRatio;
      const padL   = 36 * dpr;  // Y-axis labels
      const padB   = 16 * dpr;  // X-axis labels
      const plotW  = w - padL;
      const plotH  = h - padB;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // ── Grid ────────────────────────────────────────────────
      ctx.save();
      ctx.translate(padL, 0);

      ctx.strokeStyle = bord;
      ctx.lineWidth   = dpr;
      for (let r = 0; r <= V_DIVS_N; r++) {
        const y = (r / V_DIVS_N) * plotH;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
      }
      for (let c = 0; c <= H_DIVS; c++) {
        const x = (c / H_DIVS) * plotW;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
      }

      // Centre crosshairs
      ctx.strokeStyle = bord2;
      ctx.lineWidth   = dpr;
      ctx.beginPath(); ctx.moveTo(0, plotH / 2); ctx.lineTo(plotW, plotH / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(plotW / 2, 0); ctx.lineTo(plotW / 2, plotH); ctx.stroke();

      // ── Trigger level line ──────────────────────────────────
      const vDiv     = V_DIVS[vDivIdx];
      const divPx    = plotH / V_DIVS_N;
      const trigY    = (plotH / 2) - ((trigLevel / vDiv) + yPos) * divPx;

      ctx.strokeStyle = acc + '55';
      ctx.lineWidth   = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(0, trigY); ctx.lineTo(plotW, trigY); ctx.stroke();
      ctx.setLineDash([]);

      // Trigger arrow on left edge
      ctx.fillStyle = acc + '99';
      ctx.beginPath();
      ctx.moveTo(0, trigY);
      ctx.lineTo(6 * dpr, trigY - 4 * dpr);
      ctx.lineTo(6 * dpr, trigY + 4 * dpr);
      ctx.fill();

      // ── Waveform ────────────────────────────────────────────
      const sr = analyser.context.sampleRate;
      const timeDivMs      = TIME_DIVS[timeDivIdx];
      const samplesPerScreen = Math.ceil(timeDivMs * H_DIVS * sr / 1000);
      const length = Math.min(samplesPerScreen, buf.length - start);

      const waveColor = source.startsWith('op')
        ? style.getPropertyValue(`--op${source.slice(2)}`).trim() || acc
        : acc;
      ctx.strokeStyle = waveColor;
      ctx.lineWidth   = 1.5 * dpr;
      ctx.beginPath();
      for (let i = 0; i < length; i++) {
        const x = (i / samplesPerScreen) * plotW;
        const y = (plotH / 2) - ((buf[start + i] / vDiv) + yPos) * divPx;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.restore();

      // ── Y-axis labels ───────────────────────────────────────
      ctx.font         = `${Math.round(9 * dpr)}px "IBM Plex Mono"`;
      ctx.fillStyle    = muted;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r <= V_DIVS_N; r++) {
        const val = (V_DIVS_N / 2 - r) * vDiv;
        const y   = (r / V_DIVS_N) * plotH;
        const lbl = val === 0 ? '0' : Math.abs(val) < 0.1
          ? (val * 1000).toFixed(0) + 'm'
          : val.toFixed(1);
        ctx.fillText(lbl, padL - 4 * dpr, y);
      }

      // ── X-axis labels ───────────────────────────────────────
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      for (let c = 0; c <= H_DIVS; c++) {
        const tMs = (c - H_DIVS / 2) * timeDivMs;
        const x   = padL + (c / H_DIVS) * plotW;
        const lbl = tMs === 0 ? '0'
          : Math.abs(tMs) < 1 ? (tMs * 1000).toFixed(0) + 'μ'
          : tMs.toFixed(0);
        ctx.fillText(lbl, x, plotH + 3 * dpr);
      }

      // ── Measurements (every 10 frames) ─────────────────────
      frameCount.current++;
      if (frameCount.current % 10 === 0) {
        const slice = buf.subarray(start, start + length);
        setMeas(computeMeasurements(slice, sr));
      }
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // runs once; state via live ref

  const timeDivMs = TIME_DIVS[timeDivIdx];
  const vDiv      = V_DIVS[vDivIdx];

  const fmtFreq = (f: number) => f < 1 ? '---'
    : f >= 1000 ? (f / 1000).toFixed(2) + ' kHz'
    : f.toFixed(1) + ' Hz';
  const fmtV = (v: number) => v < 0.001 ? '---'
    : v < 0.1 ? (v * 1000).toFixed(1) + ' mV'
    : v.toFixed(3) + ' V';

  const mono9: CSSProperties = { fontFamily: 'IBM Plex Mono', fontSize: 9 };
  const lbl: CSSProperties   = { ...mono9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' as const };

  const btn = (active: boolean): CSSProperties => ({
    ...mono9, padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--acc)' : 'var(--bord)'}`,
    background: active ? 'var(--acc)22' : 'none',
    color: active ? 'var(--acc)' : 'var(--muted)',
  });

  const stepBtn: CSSProperties = {
    ...mono9, fontSize: 12, padding: '2px 8px', lineHeight: 1,
    borderRadius: 3, cursor: 'pointer',
    border: '1px solid var(--bord)', background: 'none', color: 'var(--muted)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>

      {/* ── Measurements header ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ ...mono9, color: 'var(--acc)', letterSpacing: '.15em', textTransform: 'uppercase' }}>
          Oscilloscope
        </span>
        <div style={{ flex: 1 }} />
        {frozen && <span style={{ ...mono9, color: 'var(--acc)', letterSpacing: '.12em' }}>[FROZEN]</span>}
        <span style={lbl}>freq</span>
        <span style={{ ...mono9, color: 'var(--fg)', minWidth: 68 }}>{fmtFreq(meas.freq)}</span>
        <span style={lbl}>Vpp</span>
        <span style={{ ...mono9, color: 'var(--fg)', minWidth: 56 }}>{fmtV(meas.vpp)}</span>
        <span style={lbl}>rms</span>
        <span style={{ ...mono9, color: 'var(--fg)', minWidth: 56 }}>{fmtV(meas.rms)}</span>
        <span style={{ ...mono9, color: 'var(--muted)', fontSize: 8 }}>tap or F to freeze</span>
      </div>

      {/* ── Source selector ────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={lbl}>source</span>
        <button style={btn(source === 'master')}  onClick={() => setSource('master')}>master</button>
        <button style={btn(source === 'pre-fx')}  onClick={() => setSource('pre-fx')}>pre-fx</button>
        <span style={{ ...lbl, marginLeft: 4 }}>op</span>
        {([1, 2, 3, 4, 5, 6] as const).map(n => {
          const key = `op${n}` as ScopeSource;
          const active = source === key;
          return (
            <button key={n} onClick={() => setSource(key)} style={{
              ...btn(active),
              ...(active ? {
                borderColor: `var(--op${n})`,
                background:  `var(--op${n})22`,
                color:        `var(--op${n})`,
              } : {}),
            }}>{n}</button>
          );
        })}
      </div>

      {/* ── Canvas ─────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        onPointerDown={e => { e.preventDefault(); toggleFreeze(); }}
        style={{ flex: 1, minHeight: 0, display: 'block', width: '100%',
          borderRadius: 2, cursor: 'crosshair' }}
      />

      {/* ── Controls row 1: timebase · v/div · y-pos · coupling */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={lbl}>time/div</span>
          <button style={stepBtn} onClick={() => setTimeDivIdx(i => Math.max(0, i - 1))}>−</button>
          <span style={{ ...mono9, fontSize: 10, color: 'var(--fg)', minWidth: 40, textAlign: 'center' }}>
            {timeDivMs < 1 ? (timeDivMs * 1000).toFixed(0) + 'μs' : timeDivMs + 'ms'}
          </span>
          <button style={stepBtn} onClick={() => setTimeDivIdx(i => Math.min(TIME_DIVS.length - 1, i + 1))}>+</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={lbl}>v/div</span>
          <button style={stepBtn} onClick={() => setVDivIdx(i => Math.max(0, i - 1))}>−</button>
          <span style={{ ...mono9, fontSize: 10, color: 'var(--fg)', minWidth: 44, textAlign: 'center' }}>
            {vDiv < 0.1 ? (vDiv * 1000).toFixed(0) + 'mV' : vDiv + 'V'}
          </span>
          <button style={stepBtn} onClick={() => setVDivIdx(i => Math.min(V_DIVS.length - 1, i + 1))}>+</button>
        </div>

        <Knob value={yPos} min={-4} max={4} step={0.1}
          label="y-pos" display={v => (v >= 0 ? '+' : '') + v.toFixed(1)}
          color="var(--acc)" onChange={setYPos} size={36} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={lbl}>coupling</span>
          <button style={btn(coupling === 'DC')} onClick={() => setCoupling('DC')}>DC</button>
          <button style={btn(coupling === 'AC')} onClick={() => setCoupling('AC')}>AC</button>
        </div>
      </div>

      {/* ── Controls row 2: trigger ────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        flexWrap: 'wrap', paddingBottom: 2 }}>
        <span style={lbl}>trigger</span>

        <Knob value={trigLevel} min={-1} max={1} step={0.01}
          label="level" display={v => v.toFixed(2)}
          color="var(--acc)" onChange={setTrigLevel} size={36} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={lbl}>edge</span>
          <button style={btn(trigEdge === 'rise')} onClick={() => setTrigEdge('rise')}>↑ rise</button>
          <button style={btn(trigEdge === 'fall')} onClick={() => setTrigEdge('fall')}>↓ fall</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={lbl}>mode</span>
          <button style={btn(trigMode === 'auto')}   onClick={() => setTrigMode('auto')}>auto</button>
          <button style={btn(trigMode === 'normal')} onClick={() => setTrigMode('normal')}>norm</button>
          <button style={btn(trigMode === 'single')} onClick={activateSingle}>single</button>
        </div>
      </div>
    </div>
  );
}
