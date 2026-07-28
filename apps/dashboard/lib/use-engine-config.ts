"use client";

/**
 * Live engine tuning.
 *
 * Slider moves are pushed straight to the Rust engine and the value it
 * echoes back — after clamping — becomes the displayed value, so the UI can
 * never show a setting the pipeline is not actually using. Writes are
 * debounced so dragging a slider does not flood the engine.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Thresholds the engine exposes, mirroring `EngineConfig` in Rust. */
export interface EngineConfig {
  sensitivity: number;
  background_alpha: number;
  min_region_area: number;
  min_track_iou: number;
  gate_frames: number;
  max_missed_frames: number;
  motion_ratio: number;
}

export function useEngineConfig() {
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch("/engine/api/config")
      .then((r) => (r.ok ? (r.json() as Promise<EngineConfig>) : Promise.reject(r.status)))
      .then(setConfig)
      .catch(() => setError("engine not reachable"));
  }, []);

  const update = useCallback((patch: Partial<EngineConfig>) => {
    setConfig((current) => {
      if (current === null) return current;
      const next = { ...current, ...patch };
      if (pending.current !== undefined) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        setSaving(true);
        fetch("/engine/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        })
          .then((r) => (r.ok ? (r.json() as Promise<EngineConfig>) : Promise.reject(r.status)))
          .then((applied) => {
            setConfig(applied); // show what the engine accepted, not what we asked for
            setError(null);
          })
          .catch(() => setError("could not apply settings"))
          .finally(() => setSaving(false));
      }, 150);
      return next;
    });
  }, []);

  return { config, update, saving, error };
}
