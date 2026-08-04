// Ambient declarations for AudioWorkletGlobalScope.
//
// Worklet code runs in a scope that is neither Window nor Worker, and TypeScript
// ships no lib for it. These are the pieces the processors here actually use.

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;
