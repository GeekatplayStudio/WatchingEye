"use client";

/** Labeled range slider used by the tuning panel. */
import { cn } from "@/lib/utils";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  className?: string;
}

export function Slider({ label, value, min, max, step, format, onChange, className }: SliderProps) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm text-foreground">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
      />
    </label>
  );
}
