import { useEffect, useRef } from 'react';
import { engine } from '../../engine/AudioEngine';

// Computer keyboard → semitone map (C4 = 60, but we use relative layout)
const KEY_MAP: Record<string, number> = {
  z:48, s:49, x:50, d:51, c:52, v:53, g:54, b:55, h:56, n:57, j:58, m:59,
  q:60, 2:61, w:62, 3:63, e:64, r:65, 5:66, t:67, 6:68, y:69, 7:70, u:71,
  i:72, 9:73, o:74, 0:75, p:76,
};

export function useKeyboard() {
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const semi = KEY_MAP[e.key.toLowerCase()];
      if (semi != null && !heldKeys.current.has(e.key)) {
        heldKeys.current.add(e.key);
        engine.noteOn(semi);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const semi = KEY_MAP[e.key.toLowerCase()];
      if (semi != null) {
        heldKeys.current.delete(e.key);
        engine.noteOff(semi);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
    };
  }, []);

  // MIDI
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;
    let inputs: MIDIInputMap;
    navigator.requestMIDIAccess().then(access => {
      inputs = access.inputs;
      const handleMidi = (e: MIDIMessageEvent) => {
        if (!e.data) return;
        const [status, note, velocity] = Array.from(e.data);
        const type = status & 0xf0;
        if (type === 0x90 && velocity > 0) engine.noteOn(note, velocity / 127);
        else if (type === 0x80 || (type === 0x90 && velocity === 0)) engine.noteOff(note);
      };
      inputs.forEach(input => input.onmidimessage = handleMidi);
      access.onstatechange = () => {
        access.inputs.forEach(input => input.onmidimessage = handleMidi);
      };
    }).catch(() => {});
  }, []);
}
