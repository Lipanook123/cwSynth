import React, { useState, useRef } from 'react';
import { presetManager } from '../../presets/PresetManager';
import type { PresetMeta } from '../../presets/PresetManager';

interface Props {
  presets: PresetMeta[];
  currentName: string;
  onLoad: (m: PresetMeta) => void;
  onSave: (name: string, tags: string[]) => void;
  onExport: () => void;
  onImport: (f: File) => void;
}

export const PresetBrowser: React.FC<Props> = ({ presets, currentName, onLoad, onSave, onExport, onImport }) => {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = presets.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const factory = filtered.filter(p => !p.id.startsWith('user_'));
  const user    = filtered.filter(p => p.id.startsWith('user_'));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="search presets…"
        style={{ background:'var(--surf)', border:'1px solid var(--bord)', borderRadius:4,
          padding:'7px 10px', color:'var(--fg)', fontFamily:'IBM Plex Mono', fontSize:11, outline:'none' }}/>

      {/* Factory */}
      <div>
        <div style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.15em', textTransform:'uppercase', marginBottom:6 }}>Factory</div>
        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
          {factory.map(p => <PresetRow key={p.id} meta={p} active={p.name===currentName} onLoad={() => onLoad(p)} />)}
        </div>
      </div>

      {user.length > 0 && (
        <div>
          <div style={{ fontSize:8, color:'var(--muted)', letterSpacing:'.15em', textTransform:'uppercase', marginBottom:6 }}>User</div>
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {user.map(p => (
              <PresetRow key={p.id} meta={p} active={p.name===currentName} onLoad={() => onLoad(p)}
                onDelete={() => { presetManager.delete(p.id); window.location.reload(); }} />
            ))}
          </div>
        </div>
      )}

      {/* Save / export / import */}
      <div style={{ borderTop:'1px solid var(--bord)', paddingTop:10, display:'flex', flexDirection:'column', gap:6 }}>
        {saving ? (
          <div style={{ display:'flex', gap:6 }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="patch name…" autoFocus
              style={{ flex:1, background:'var(--surf)', border:'1px solid var(--acc)', borderRadius:4,
                padding:'6px 8px', color:'var(--fg)', fontFamily:'IBM Plex Mono', fontSize:11, outline:'none' }}
              onKeyDown={e => { if (e.key==='Enter') { onSave(saveName,[]); setSaving(false); setSaveName(''); } if (e.key==='Escape') setSaving(false); }}/>
            <Btn onClick={() => { onSave(saveName,[]); setSaving(false); setSaveName(''); }} color="var(--acc)">save</Btn>
            <Btn onClick={() => setSaving(false)}>cancel</Btn>
          </div>
        ) : (
          <div style={{ display:'flex', gap:6 }}>
            <Btn onClick={() => { setSaveName(currentName); setSaving(true); }} color="var(--acc)">save patch</Btn>
            <Btn onClick={onExport}>export .cwsyn</Btn>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".cwsyn,.json" style={{ display:'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) { onImport(f); e.target.value = ''; } }}/>
        <Btn onClick={() => fileRef.current?.click()}>import .cwsyn</Btn>
      </div>
    </div>
  );
};

const Btn: React.FC<{ onClick: () => void; color?: string; children: React.ReactNode; as?: string }> = ({ onClick, color, children }) => (
  <button onClick={onClick} style={{
    padding:'6px 12px', borderRadius:4, border:`1px solid ${color ?? 'var(--bord)'}`,
    background: color ? color+'22' : 'none', color: color ?? 'var(--muted)',
    fontFamily:'IBM Plex Mono', fontSize:10, cursor:'pointer', whiteSpace:'nowrap',
  }}>{children}</button>
);

const PresetRow: React.FC<{ meta: PresetMeta; active: boolean; onLoad: () => void; onDelete?: () => void }> = ({ meta, active, onLoad, onDelete }) => (
  <div onClick={onLoad} style={{
    display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:4, cursor:'pointer',
    background: active ? 'var(--acc)22' : 'var(--surf)', border:`1px solid ${active ? 'var(--acc)' : 'var(--bord)'}`,
    transition:'all .1s',
  }}>
    <span style={{ flex:1, fontSize:11, color: active ? 'var(--acc)' : 'var(--fg)', fontFamily:'IBM Plex Mono' }}>{meta.name}</span>
    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
      {meta.tags.slice(0,3).map(t => (
        <span key={t} style={{ fontSize:8, color:'var(--muted)', background:'var(--bord)', padding:'1px 5px', borderRadius:2 }}>{t}</span>
      ))}
    </div>
    {onDelete && (
      <button onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:12, padding:'0 2px' }}>×</button>
    )}
  </div>
);
