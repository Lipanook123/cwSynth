import { useState, useCallback, useEffect } from 'react';
import { engine } from '../../engine/AudioEngine';
import type { PatchParams } from '../../engine/Types';
import { presetManager } from '../../presets/PresetManager';
import type { PresetMeta } from '../../presets/PresetManager';

export function useEngine() {
  const [patch, setPatch] = useState<PatchParams>(engine.getPatch());
  const [presets, setPresets] = useState<PresetMeta[]>(presetManager.all());

  useEffect(() => {
    engine.setOnStateChange(() => setPatch({ ...engine.getPatch() }));
    return () => engine.setOnStateChange(() => {});
  }, []);

  const updatePatch = useCallback((partial: Partial<PatchParams>) => {
    engine.updatePatch(partial);
    setPatch({ ...engine.getPatch() });
  }, []);

  const loadPreset = useCallback((meta: PresetMeta) => {
    engine.loadPatch(meta.patch);
    setPatch({ ...engine.getPatch() });
  }, []);

  const savePreset = useCallback((name: string, tags: string[]) => {
    const meta = presetManager.save(name, engine.getPatch(), tags);
    setPresets(presetManager.all());
    return meta;
  }, []);

  const deletePreset = useCallback((id: string) => {
    presetManager.delete(id);
    setPresets(presetManager.all());
  }, []);

  const exportPatch = useCallback((name: string) => {
    presetManager.exportFile(engine.getPatch(), name);
  }, []);

  const importPatch = useCallback(async (file: File) => {
    const p = await presetManager.importFile(file);
    engine.loadPatch(p);
    setPatch({ ...engine.getPatch() });
  }, []);

  return { patch, updatePatch, presets, loadPreset, savePreset, deletePreset, exportPatch, importPatch };
}
