import { useEffect, type RefObject } from 'react';

/**
 * Keep a canvas's backing store matched to its laid-out size at device pixel
 * ratio.
 *
 * Two details stop this triggering "ResizeObserver loop completed with
 * undelivered notifications", which the scope canvases used to emit constantly:
 *
 * 1. Assigning `canvas.width`/`height` resets the backing store and invalidates
 *    layout *even when the value is unchanged*. Writing them unconditionally
 *    inside the observer callback is therefore self-triggering. Only write when
 *    the size actually changed.
 * 2. The write is deferred to the next animation frame, so it can never
 *    re-enter the observer synchronously.
 */
export function useCanvasResize(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;

    const apply = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.offsetWidth * dpr);
      const h = Math.round(canvas.offsetHeight * dpr);
      if (!w || !h) return;                                   // hidden tab
      if (canvas.width === w && canvas.height === h) return;   // nothing to do
      canvas.width = w;
      canvas.height = h;
    };

    apply();

    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(apply);
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [canvasRef]);
}
