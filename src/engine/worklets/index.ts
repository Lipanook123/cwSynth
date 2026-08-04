// Worklet module loading.
//
// Vite's `?worker&url` emits each worklet as a standalone bundled chunk and
// hands back its URL — verified to evaluate correctly inside
// AudioWorkletGlobalScope in both dev and production builds.
//
// Loading is asynchronous but noteOn is not, so nothing here may block a note.
// Instead the engine preloads early (see AudioEngine.preload) and every consumer
// checks `workletsReady()` and falls back to stock Web Audio nodes if the module
// has not arrived. A patch must always make sound.

import ladderUrl from './ladder.worklet.ts?worker&url';
import analogOscUrl from './analog-osc.worklet.ts?worker&url';
import { logger } from '../../debug/Logger';

export const LADDER_PROCESSOR = 'cw-ladder-filter';
export const ANALOG_OSC_PROCESSOR = 'cw-analog-osc';

const loaded = new WeakSet<BaseAudioContext>();
const pending = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Load the worklet modules into a context. Idempotent, and safe to call before
 * the context has been resumed.
 *
 * Resolves true when the processors are registered, false when they are not —
 * callers fall back rather than fail.
 */
export function loadWorklets(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return Promise.resolve(true);
  const existing = pending.get(ctx);
  if (existing) return existing;

  if (!ctx.audioWorklet) {
    logger.warn('AudioWorklet unsupported — using fallback nodes');
    return Promise.resolve(false);
  }

  const p = Promise.all([
    ctx.audioWorklet.addModule(ladderUrl),
    ctx.audioWorklet.addModule(analogOscUrl),
  ])
    .then(() => {
      loaded.add(ctx);
      logger.info('worklets loaded: ladder filter + analog oscillator');
      return true;
    })
    .catch((err: unknown) => {
      logger.error(`worklet load failed, falling back: ${String(err)}`);
      return false;
    });

  pending.set(ctx, p);
  return p;
}

/** True once the processors are registered on this context. */
export function workletsReady(ctx: BaseAudioContext | null): boolean {
  return !!ctx && loaded.has(ctx);
}
