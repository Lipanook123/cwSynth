import { useState, useEffect, useCallback } from 'react';
import { useEngine } from './hooks/useEngine';
import { useKeyboard } from './hooks/useKeyboard';
import { OperatorPanel } from './components/OperatorPanel';
import { AlgorithmView } from './components/AlgorithmView';
import { FilterPanel } from './components/FilterPanel';
import { FxPanel } from './components/FxPanel';
import { ArpPanel } from './components/ArpPanel';
import { LfoPanel } from './components/LfoPanel';
import { PresetBrowser } from './components/PresetBrowser';
import { RandomControls } from './components/RandomControls';
import { Keyboard } from './components/Keyboard';
import { Scope } from './components/Scope';
import { LogViewer } from './components/LogViewer';
import { ALGORITHMS } from '../engine/Algorithms';
import { Knob } from './components/Knob';
import {
  generateSeed,
  randomPatch, randomiseOperators, randomiseAlgorithm,
  randomiseFilter, randomiseFx, randomiseArp,
} from '../engine/Randomiser';
import type { RandomMode } from '../engine/Randomiser';

type Tab = 'operators' | 'algorithm' | 'filter' | 'fx' | 'arp' | 'lfo' | 'presets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'operators', label: 'Operators' },
  { id: 'algorithm', label: 'Algorithm' },
  { id: 'filter',    label: 'Filter'    },
  { id: 'fx',        label: 'FX'        },
  { id: 'arp',       label: 'Arp'       },
  { id: 'lfo',       label: 'LFO'       },
  { id: 'presets',   label: 'Presets'   },
];

type ArpState = {
  enabled: boolean; pattern: 'up'|'down'|'updown'|'random';
  holdMode: 'hold'|'latch'; rate: number; gate: number; octaves: number;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('operators');
  const [theme, setTheme] = useState<'dark'|'light'>(
    () => (localStorage.getItem('cw_theme') as 'dark'|'light') ?? 'dark'
  );
  const [arpState, setArpState] = useState<ArpState>({
    enabled: false, pattern: 'up', holdMode: 'latch', rate: 8, gate: 0.6, octaves: 1,
  });

  // Randomiser state — shared across topbar + tabs
  const [rMode, setRMode]   = useState<RandomMode>('safe');
  const [rSeed, setRSeed]   = useState<string>(String(generateSeed()));

  const { patch, updatePatch, presets, loadPreset, savePreset, deletePreset, exportPatch, importPatch } = useEngine();
  useKeyboard();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cw_theme', theme);
  }, [theme]);

  const algo = ALGORITHMS.find(a => a.id === patch.algorithm) ?? ALGORITHMS[0];

  const updateOp = (i: number, p: object) => {
    const ops = [...patch.operators];
    ops[i] = { ...ops[i], ...p };
    updatePatch({ operators: ops });
  };

  // ── Randomise handlers ───────────────────────────────────────────────────
  const handleGlobalRandom = useCallback((seed: string, mode: RandomMode) => {
    const p = randomPatch(seed || generateSeed(), mode);
    updatePatch(p);
  }, [updatePatch]);

  const handleTabRandom = useCallback((seed: string, mode: RandomMode) => {
    const s = seed || String(generateSeed());
    switch (tab) {
      case 'operators': updatePatch(randomiseOperators(patch, s, mode)); break;
      case 'algorithm': updatePatch(randomiseAlgorithm(patch, s, mode)); break;
      case 'filter':    updatePatch(randomiseFilter(patch, s, mode));    break;
      case 'fx':        updatePatch(randomiseFx(patch, s, mode));        break;
      case 'arp': {
        const a = randomiseArp(patch, s, mode);
        setArpState(prev => ({ ...prev, ...a, pattern: a.pattern as ArpState['pattern'] }));
        break;
      }
      case 'lfo': {
        const rng = mulberry32str(s);
        const shapes = ['sine', 'triangle', 'sawtooth', 'square', 'random'] as const;
        const mkLfo = () => ({
          shape: shapes[Math.floor(rng() * shapes.length)],
          rate: mode === 'safe' ? 0.5 + rng() * 9.5 : rng() * 20,
          depth: rng() * (mode === 'safe' ? 0.6 : 1),
          delay: mode === 'safe' ? rng() * 1 : rng() * 3,
          sync: rng() > 0.3,
        });
        updatePatch({ lfo1: mkLfo(), lfo2: mkLfo() });
        break;
      }
      default: break;
    }
  }, [tab, patch, updatePatch]);

  const handleOpRandom = useCallback((opIndex: number, seed: string, mode: RandomMode) => {
    const s = seed || String(generateSeed());
    const rng = mulberry32str(s);
    const waves = mode === 'safe' ? ['sine','sine','sine','triangle'] : ['sine','triangle','sawtooth','square'];
    const safeRatios = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8];
    const pick = (arr: string[] | number[]) => arr[Math.floor(rng() * arr.length)];
    const range = (min: number, max: number) => min + rng() * (max - min);
    const bool = (p = 0.5) => rng() < p;
    updateOp(opIndex, {
      wave: pick(waves) as any,
      ratio: mode === 'safe' ? pick(safeRatios) as number : range(0.5, 16),
      fine: mode === 'safe' ? range(-20, 20) : range(-100, 100),
      level: range(0.3, 1),
      feedback: mode === 'safe' ? range(0, 0.15) : range(0, 0.6),
      attack: mode === 'safe' ? range(0.001, 0.1) : range(0.001, 2),
      decay: mode === 'safe' ? range(0.05, 1.5) : range(0.001, 6),
      sustain: range(0, 1),
      release: mode === 'safe' ? range(0.05, 1.0) : range(0.001, 4),
      karplusStrong: mode === 'safe' ? false : bool(0.08),
    });
  }, [patch]);

  return (
    <div className="app-root">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span className="logo">CW<span className="logo-fm">Synth</span></span>
          <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'IBM Plex Mono', letterSpacing: '.12em', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {patch.name}
          </span>
        </div>

        <div className="topbar-scope" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Scope />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Global randomise */}
          <div className="topbar-rand">
            <RandomControls
              mode={rMode} seed={rSeed}
              onModeChange={setRMode} onSeedChange={setRSeed}
              onRandomise={handleGlobalRandom}
              label="patch"
            />
          </div>
          <Knob value={patch.volume} min={0} max={1} step={0.01}
            label="vol" display={v => Math.round(v * 100) + '%'} color="var(--acc)"
            onChange={v => updatePatch({ volume: v })} size={36} />
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="theme-btn">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <nav className="tabbar">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Tab randomise strip (shown for all tabs except presets) ───────── */}
      {tab !== 'presets' && (
        <div className="tab-rand-strip">
          <span style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase' }}>
            Randomise {TABS.find(t => t.id === tab)?.label}
          </span>
          <RandomControls
            mode={rMode} seed={rSeed}
            onModeChange={setRMode} onSeedChange={setRSeed}
            onRandomise={handleTabRandom}
            compact
          />
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main className="content">
        {tab === 'operators' && (
          <div className="op-grid">
            {patch.operators.map((op, i) => (
              <OperatorPanel key={i} index={i} params={op}
                isCarrier={algo.carriers.includes(i)}
                onChange={p => updateOp(i, p)}
                onRandomise={(seed, mode) => handleOpRandom(i, seed, mode)}
                rMode={rMode} rSeed={rSeed}
              />
            ))}
          </div>
        )}

        {tab === 'algorithm' && (
          <AlgorithmView value={patch.algorithm}
            onChange={v => updatePatch({ algorithm: v })} />
        )}

        {tab === 'filter' && (
          <FilterPanel params={patch.filter}
            onChange={p => updatePatch({ filter: { ...patch.filter, ...p } })} />
        )}

        {tab === 'fx' && (
          <FxPanel params={patch.fx}
            onChange={p => updatePatch({ fx: { ...patch.fx, ...p } })} />
        )}

        {tab === 'arp' && (
          <ArpPanel state={arpState}
            onChange={s => setArpState(prev => ({ ...prev, ...s }))} />
        )}

        {tab === 'lfo' && (
          <LfoPanel patch={patch} onChange={updatePatch} />
        )}

        {tab === 'presets' && (
          <PresetBrowser
            presets={presets} currentName={patch.name}
            onLoad={loadPreset} onSave={savePreset} onDelete={deletePreset}
            onExport={exportPatch} onImport={importPatch}
          />
        )}
      </main>

      {/* ── Keyboard ──────────────────────────────────────────────────────── */}
      <Keyboard />

      {/* ── Debug log viewer ─────────────────────────────────────────────── */}
      <LogViewer />
    </div>
  );
}

// Mini inline helper to avoid a circular import for per-op randomise
function mulberry32str(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let seed = h >>> 0;
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
