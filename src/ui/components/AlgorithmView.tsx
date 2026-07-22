import React from 'react';
import { ALGORITHMS } from '../../engine/Algorithms';

interface Props {
  value: number;
  onChange: (id: number) => void;
}

const OP_COLORS = ['#4a9eff','#7b6fff','#ff6b9d','#ffaa4a','#4af0a0','#ff4a6b'];

// Minimal visual: draw a small SVG diagram for current algorithm
const AlgoDiagram: React.FC<{ id: number }> = ({ id }) => {
  const algo = ALGORITHMS.find(a => a.id === id) ?? ALGORITHMS[0];
  const W = 120, H = 80;
  // Position ops in two rows: 4 top (ops 5,4,3,2), 2 bottom (ops 1,0 carriers)
  const pos: [number,number][] = [
    [60, 68], // op1 (idx 0) — carrier row
    [96, 68], // op2
    [96, 36], // op3
    [60, 36], // op4
    [24, 36], // op5
    [24, 68], // op6
  ];

  return (
    <svg width={W} height={H} style={{ overflow:'visible' }}>
      {/* Modulator arrows */}
      {algo.modulators.map(([tgt, src], i) => {
        const [sx, sy] = pos[src], [tx, ty] = pos[tgt];
        return (
          <g key={i}>
            <line x1={sx} y1={sy} x2={tx} y2={ty}
              stroke="var(--bord2)" strokeWidth={1.5} markerEnd="url(#arr)" />
          </g>
        );
      })}
      {/* Arrow marker */}
      <defs>
        <marker id="arr" markerWidth={6} markerHeight={6} refX={5} refY={3} orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--muted)" />
        </marker>
      </defs>
      {/* Operator nodes */}
      {[0,1,2,3,4,5].map(i => {
        const [x, y] = pos[i];
        const isCarrier = algo.carriers.includes(i);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={10}
              fill={isCarrier ? OP_COLORS[i] + '33' : 'var(--surf2)'}
              stroke={OP_COLORS[i]} strokeWidth={isCarrier ? 2 : 1} />
            <text x={x} y={y+4} textAnchor="middle"
              fontSize={8} fill={OP_COLORS[i]} fontFamily="IBM Plex Mono" fontWeight="600">
              {i+1}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const AlgorithmView: React.FC<Props> = ({ value, onChange }) => {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {/* Current algo diagram */}
      <div style={{
        background:'var(--surf)', borderRadius:6, border:'1px solid var(--bord)',
        padding:'12px', display:'flex', flexDirection:'column', alignItems:'center', gap:6,
      }}>
        <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.15em', textTransform:'uppercase' }}>
          Algorithm {value}
        </span>
        <AlgoDiagram id={value} />
        <span style={{ fontSize:8, color:'var(--muted)' }}>
          {ALGORITHMS.find(a => a.id === value)?.label}
        </span>
      </div>

      {/* Grid of all algorithms */}
      <div className="algo-grid">
        {ALGORITHMS.map(a => (
          <button key={a.id} onClick={() => onChange(a.id)}
            style={{
              padding:'6px 0', borderRadius:3,
              border:`1px solid ${a.id === value ? 'var(--blue)' : 'var(--bord)'}`,
              background: a.id === value ? 'var(--blue)22' : 'none',
              color: a.id === value ? 'var(--blue)' : 'var(--muted)',
              fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:600, cursor:'pointer',
              transition:'all .1s',
            }}>{a.id}</button>
        ))}
      </div>
    </div>
  );
};
