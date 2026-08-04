import React from 'react';
import type { PatchParams, VoiceMode, NotePriority } from '../../engine/Types';
import { Knob } from './Knob';

interface Props {
  patch: PatchParams;
  onChange: (p: Partial<PatchParams>) => void;
}

const MODES: { id: VoiceMode; label: string; hint: string }[] = [
  { id: 'poly',   label: 'poly',   hint: 'A voice per note, up to the polyphony limit' },
  { id: 'mono',   label: 'mono',   hint: 'One voice; every new note retriggers the envelopes' },
  { id: 'legato', label: 'legato', hint: 'One voice; overlapping notes glide without retriggering' },
];

const PRIORITIES: { id: NotePriority; label: string; hint: string }[] = [
  { id: 'last', label: 'last', hint: 'The most recently pressed key wins' },
  { id: 'low',  label: 'low',  hint: 'The lowest held key wins — the Minimoog behaviour' },
  { id: 'high', label: 'high', hint: 'The highest held key wins' },
];

const chip = (active: boolean, color = 'var(--acc)'): React.CSSProperties => ({
  padding: '6px 0', borderRadius: 3,
  border: `1px solid ${active ? color : 'var(--bord)'}`,
  background: active ? color + '22' : 'none',
  color: active ? color : 'var(--muted)',
  fontFamily: 'IBM Plex Mono', fontSize: 8, cursor: 'pointer',
});

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ background: 'var(--surf)', borderRadius: 6, padding: '10px 10px 12px',
    border: '1px solid var(--bord)', display: 'flex', flexDirection: 'column', gap: 8 }}>
    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--acc)', letterSpacing: '.12em',
      textTransform: 'uppercase' }}>{label}</span>
    {children}
  </div>
);

export const VoicePanel: React.FC<Props> = ({ patch, onChange }) => {
  const isMono = patch.voiceMode !== 'poly';
  const unison = patch.unison;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <Section label="Voice mode">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3 }}>
          {MODES.map(m => (
            <button key={m.id} title={m.hint} style={chip(patch.voiceMode === m.id)}
              onClick={() => onChange({ voiceMode: m.id })}>{m.label}</button>
          ))}
        </div>

        {isMono ? (
          <>
            <span style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.1em',
              textTransform: 'uppercase', marginTop: 4 }}>Note priority</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3 }}>
              {PRIORITIES.map(p => (
                <button key={p.id} title={p.hint} style={chip(patch.notePriority === p.id)}
                  onClick={() => onChange({ notePriority: p.id })}>{p.label}</button>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <Knob value={patch.polyphony} min={1} max={32} step={1}
              label="polyphony" display={v => String(Math.round(v))} color="var(--acc)"
              onChange={v => onChange({ polyphony: Math.round(v) })} size={44} />
          </div>
        )}

        <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5 }}>
          {patch.voiceMode === 'legato'
            ? 'Overlapping notes glide without a new attack. Release fully between notes to retrigger.'
            : patch.voiceMode === 'mono'
              ? 'One note at a time. Releasing a key falls back to any note still held.'
              : 'Oldest note is stolen once the polyphony limit is reached.'}
        </div>
      </Section>

      <Section label="Glide">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Knob value={patch.glide} min={0} max={2} step={0.001}
            label="time" display={v => v <= 0.0005 ? 'off' : (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's')}
            color="var(--acc)" onChange={v => onChange({ glide: v })} size={48} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5 }}>
          Portamento between notes, exponential so the slide is even in pitch
          rather than in Hz. Fixed-frequency operators do not glide.
        </div>
      </Section>

      <Section label="Unison">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          <Knob value={unison.voices} min={1} max={8} step={1}
            label="voices" display={v => Math.round(v) === 1 ? 'off' : String(Math.round(v))}
            color="var(--acc)"
            onChange={v => onChange({ unison: { ...unison, voices: Math.round(v) } })} size={44} />
          <Knob value={unison.detune} min={0} max={50} step={0.5}
            label="detune" display={v => v.toFixed(1) + '¢'} color="var(--acc)"
            onChange={v => onChange({ unison: { ...unison, detune: v } })} size={44} />
          <Knob value={unison.spread} min={0} max={1} step={0.01}
            label="spread" display={v => Math.round(v * 100) + '%'} color="var(--acc)"
            onChange={v => onChange({ unison: { ...unison, spread: v } })} size={44} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5 }}>
          Stacked detuned voices per note, panned across the stereo field.
          Each layer counts against polyphony, so a 7-voice unison at a limit of
          16 gives you two notes.
        </div>
      </Section>
    </div>
  );
};
