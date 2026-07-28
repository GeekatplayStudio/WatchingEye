"use client";

/**
 * Compact tuning strip shown beside the live view, so a threshold change and
 * its effect are visible at the same time. Every control writes straight to
 * the engine and displays the value the engine accepted.
 */
import { SlidersHorizontal } from "lucide-react";
import type { EngineConfig } from "@/lib/use-engine-config";

interface RowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Row({ label, hint, value, min, max, step, format, onChange }: RowProps) {
  return (
    <label className="block" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
      />
    </label>
  );
}

export function LiveTuning({
  config,
  update,
  saving,
}: {
  config: EngineConfig | null;
  update: (patch: Partial<EngineConfig>) => void;
  saving: boolean;
}) {
  if (config === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Engine not reachable — tuning unavailable.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
          Live tuning
        </span>
        {saving && <span className="text-[10px] text-muted-foreground">applying…</span>}
      </div>

      <Row
        label="Sensitivity"
        hint="How different a pixel must be from the learned background to count as movement. Lower catches more, including noise."
        value={config.sensitivity}
        min={2}
        max={80}
        step={1}
        format={(v) => `${v.toFixed(0)}`}
        onChange={(v) => update({ sensitivity: v })}
      />
      <Row
        label="Min object size"
        hint="Regions smaller than this are discarded as sensor noise."
        value={config.min_region_area}
        min={1}
        max={400}
        step={1}
        format={(v) => `${v} px`}
        onChange={(v) => update({ min_region_area: v })}
      />
      <Row
        label="Frames before AI runs"
        hint="How many consecutive frames an object must persist before the vision model is consulted."
        value={config.gate_frames}
        min={1}
        max={20}
        step={1}
        format={(v) => `${v}`}
        onChange={(v) => update({ gate_frames: v })}
      />
      <Row
        label="Track stickiness"
        hint="Overlap needed to treat a region as the same object between frames. Higher splits objects more readily."
        value={config.min_track_iou}
        min={0.02}
        max={0.7}
        step={0.01}
        format={(v) => `${(v * 100).toFixed(0)}%`}
        onChange={(v) => update({ min_track_iou: v })}
      />
      <Row
        label="Scene memory"
        hint="How fast the background adapts. Higher holds a still object visible for longer before it becomes scenery."
        value={config.background_alpha}
        min={0.8}
        max={0.999}
        step={0.001}
        format={(v) => v.toFixed(3)}
        onChange={(v) => update({ background_alpha: v })}
      />
      <p className="text-[10px] leading-snug text-muted-foreground">
        Changing sensitivity or scene memory makes the engine re-learn the background, so the
        view goes quiet for a second.
      </p>
    </div>
  );
}
