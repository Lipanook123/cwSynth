import React, { useEffect, useRef } from 'react';
import { engine } from '../../engine/AudioEngine';

export const Scope: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

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
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#06080c';
      ctx.fillRect(0, 0, w, h);

      // Grid line
      ctx.strokeStyle = '#131820';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

      const analyser = engine.getAnalyser();
      if (!analyser) return;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);

      ctx.strokeStyle = '#4af0a0';
      ctx.lineWidth   = 1.5 * devicePixelRatio;
      ctx.beginPath();
      buf.forEach((v, i) => {
        const x = (i / buf.length) * w;
        const y = (1 - (v + 1) / 2) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    draw();
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} style={{ flex:1, height:28, minWidth:0, borderRadius:2, display:'block' }} />;
};
