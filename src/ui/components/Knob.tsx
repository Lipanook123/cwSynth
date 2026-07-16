import React, { useRef, useCallback } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  display?: (v: number) => string;
  onChange: (v: number) => void;
  color?: string;
  size?: number;
}

export const Knob: React.FC<KnobProps> = ({
  value, min, max, step = 0.001, label, display, onChange, color = 'var(--acc)', size = 44,
}) => {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);

  const norm = (v: number) => (v - min) / (max - min);
  const angle = -135 + norm(value) * 270;
  const fmt = display ? display(value) : value.toFixed(2);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const snap  = (v: number) => step ? Math.round(v / step) * step : v;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startVal: value };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = (dragRef.current.startY - me.clientY) / 200;
      onChange(clamp(snap(dragRef.current.startVal + delta * (max - min))));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [value, min, max, onChange, snap]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY / 500 * (max - min);
    onChange(clamp(snap(value + delta)));
  }, [value, min, max, onChange, snap]);

  const onDblClick = useCallback(() => {
    const v = parseFloat(prompt(`${label} (${min}–${max})`, String(value)) ?? '');
    if (!isNaN(v)) onChange(clamp(snap(v)));
  }, [value, min, max, label, onChange, snap]);

  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const toXY = (deg: number) => ({
    x: cx + r * Math.sin((deg * Math.PI) / 180),
    y: cy - r * Math.cos((deg * Math.PI) / 180),
  });
  const start = toXY(-135), end = toXY(angle);
  const large = Math.abs(angle - (-135)) > 180 ? 1 : 0;

  return (
    <div className="knob-wrap" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, userSelect:'none' }}>
      <svg
        width={size} height={size}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onDoubleClick={onDblClick}
        style={{ cursor:'ns-resize', flexShrink:0 }}
      >
        {/* Track */}
        <path
          d={`M ${toXY(-135).x} ${toXY(-135).y} A ${r} ${r} 0 1 1 ${toXY(135).x} ${toXY(135).y}`}
          fill="none" stroke="var(--bord)" strokeWidth={3} strokeLinecap="round"
        />
        {/* Value arc */}
        {norm(value) > 0.001 && (
          <path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          />
        )}
        {/* Pointer */}
        <line
          x1={cx} y1={cy}
          x2={cx + (r - 4) * Math.sin((angle * Math.PI) / 180)}
          y2={cy - (r - 4) * Math.cos((angle * Math.PI) / 180)}
          stroke={color} strokeWidth={2} strokeLinecap="round"
        />
        {/* Centre dot */}
        <circle cx={cx} cy={cy} r={3} fill="var(--surf2)" />
      </svg>
      <span style={{ fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>{label}</span>
      <span style={{ fontSize:10, color, fontWeight:600, fontFamily:'IBM Plex Mono' }}>{fmt}</span>
    </div>
  );
};
