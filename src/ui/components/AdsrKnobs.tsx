import React from 'react';
import type { EnvParams, EnvStage } from '../../engine/Types';
import { adsrToEnv, envToAdsr, isAdsrShaped } from '../../engine/Envelope';
import { Knob } from './Knob';

interface Props {
  env: EnvParams;
  color: string;
  maxTime?: number;
  size?: number;
  onChange: (env: EnvParams) => void;
}

const timeDisplay = (v: number) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's');
const pctDisplay  = (v: number) => Math.round(v * 100) + '%';

/**
 * Envelope editor that adapts to the envelope's shape.
 *
 * Envelopes are N-stage rate/level internally, but the classic 2-stage +
 * 1-release shape is what most patches use and what people expect to edit as
 * A/D/S/R — so that shape gets four knobs and anything else gets the full
 * per-stage grid.
 */
export const AdsrKnobs: React.FC<Props> = ({ env, color, maxTime = 8, size = 40, onChange }) => {
  const adsr = envToAdsr(env);

  if (adsr) {
    const set = (p: Partial<typeof adsr>) => {
      const next = { ...adsr, ...p };
      onChange(adsrToEnv(next.attack, next.decay, next.sustain, next.release, env));
    };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
        <Knob value={adsr.attack} min={0.001} max={maxTime} step={0.001}
          label="A" display={timeDisplay} color={color} size={size}
          onChange={v => set({ attack: v })} />
        <Knob value={adsr.decay} min={0.001} max={maxTime} step={0.001}
          label="D" display={timeDisplay} color={color} size={size}
          onChange={v => set({ decay: v })} />
        <Knob value={adsr.sustain} min={0} max={1} step={0.01}
          label="S" display={pctDisplay} color={color} size={size}
          onChange={v => set({ sustain: v })} />
        <Knob value={adsr.release} min={0.001} max={maxTime} step={0.001}
          label="R" display={timeDisplay} color={color} size={size}
          onChange={v => set({ release: v })} />
      </div>
    );
  }

  const setStage = (list: 'stages' | 'release', i: number, p: Partial<EnvStage>) =>
    onChange({ ...env, [list]: env[list].map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const rows: { key: string; label: string; stage: EnvStage; list: 'stages' | 'release'; i: number }[] = [
    ...env.stages.map((stage, i) => ({ key: `s${i}`, label: String(i + 1), stage, list: 'stages' as const, i })),
    ...env.release.map((stage, i) => ({ key: `r${i}`, label: `R${i + 1}`, stage, list: 'release' as const, i })),
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
      {rows.map(({ key, label, stage, list, i }) => (
        <React.Fragment key={key}>
          <Knob value={stage.time} min={0.001} max={maxTime} step={0.001}
            label={`t${label}`} display={timeDisplay} color={color} size={size}
            onChange={v => setStage(list, i, { time: v })} />
          <Knob value={stage.level} min={0} max={1} step={0.01}
            label={`L${label}`} display={pctDisplay} color={color} size={size}
            onChange={v => setStage(list, i, { level: v })} />
        </React.Fragment>
      ))}
    </div>
  );
};

/** Switch an envelope between the ADSR shape and the DX-7 4-stage rate/level shape. */
export function toggleEnvShape(env: EnvParams): EnvParams {
  const adsr = envToAdsr(env);
  if (adsr) {
    // ADSR → DX: three key-down stages holding at the third, plus one release stage.
    return {
      ...env,
      stages: [
        { time: adsr.attack, level: 1, curve: 'lin' },
        { time: adsr.decay, level: Math.max(adsr.sustain, 0.6), curve: 'exp' },
        { time: adsr.decay, level: adsr.sustain, curve: 'exp' },
      ],
      sustainStage: 2,
      release: [{ time: adsr.release, level: 0, curve: 'exp' }],
    };
  }
  // DX → ADSR: keep the overall timing, collapse to two stages.
  const attack = env.stages[0]?.time ?? 0.001;
  const decay = env.stages[1]?.time ?? 0.3;
  const sustain = env.stages[env.sustainStage]?.level ?? 0.5;
  const release = env.release[0]?.time ?? 0.3;
  return adsrToEnv(attack, decay, sustain, release, env);
}

export { isAdsrShaped };
