import { useEffect, useRef } from 'react';
import { engine } from '../../engine/AudioEngine';

interface Props {
  height?: number;          // px; omit to fill parent (parent must have defined height)
  stable?: boolean;         // trigger-stable zero-crossing
  showGrid?: boolean;       // CRT-style grid lines
  frozen?: boolean;         // stop updating
  flex?: boolean;           // stretch width (default true)
  onToggleFreeze?: () => void; // click/tap canvas to toggle freeze
}


export function Scope({ height, stable = false, showGrid = false, frozen = false, flex = true, onToggleFreeze }: Props) {
  const fillParent = !height;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (frozenRef.current) return;

      const w = canvas.width, h = canvas.height;
      const style = getComputedStyle(canvas);
      const bg    = style.getPropertyValue('--bg').trim()    || '#06080c';
      const bord  = style.getPropertyValue('--bord').trim()  || '#1e2535';
      const bord2 = style.getPropertyValue('--bord2').trim() || '#2a3450';
      const acc   = style.getPropertyValue('--acc').trim()   || '#4af0a0';

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (showGrid) {
        ctx.strokeStyle = bord;
        ctx.lineWidth   = 1;
        // 4 horizontal divisions
        for (let r = 1; r < 4; r++) {
          const y = (r / 4) * h;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        // 6 vertical divisions
        for (let c = 1; c < 6; c++) {
          const x = (c / 6) * w;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
      }

      // Centre line
      ctx.strokeStyle = bord2;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

      const analyser = engine.getAnalyserFor(engine.getScopeSource());
      if (!analyser) return;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);

      const { vDiv, yPos, coupling, trigLevel, trigEdge } = engine.getScopeParams();

      // AC coupling
      if (coupling === 'AC') {
        let sum = 0; for (const s of buf) sum += s;
        const mean = sum / buf.length;
        for (let i = 0; i < buf.length; i++) buf[i] -= mean;
      }

      // Trigger (always applied, using engine params)
      let start = 0;
      const mid = Math.floor(buf.length / 2);
      const range = Math.floor(buf.length / 4);
      for (let i = mid - range; i < mid + range - 1; i++) {
        if (trigEdge === 'rise' && buf[i] <= trigLevel && buf[i + 1] > trigLevel) { start = i; break; }
        if (trigEdge === 'fall' && buf[i] >= trigLevel && buf[i + 1] < trigLevel) { start = i; break; }
      }

      const length = buf.length - start;
      const divPx  = h / 8; // 8 vertical divisions, matching ScopePanel

      ctx.strokeStyle = acc;
      ctx.lineWidth   = 1.5 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < length; i++) {
        const x = (i / length) * w;
        const y = (h / 2) - ((buf[start + i] / vDiv) + yPos) * divPx;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [stable, showGrid]);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onToggleFreeze ? (e) => { e.preventDefault(); onToggleFreeze(); } : undefined}
      style={{
        display: 'block',
        borderRadius: 2,
        cursor: onToggleFreeze ? 'crosshair' : undefined,
        ...(fillParent
          ? { width: '100%', height: '100%' }
          : flex
            ? { flex: 1, minWidth: 0, height }
            : { width: '100%', height }),
      }}
    />
  );
}
