"use client";

/**
 * Animatronics readout: where the head is pointing and why.
 *
 * Shows the commanded angles rather than any measured feedback — this is what
 * the controller was told to do. Until a servo controller reports back, that
 * distinction matters, so the panel says "commanded".
 */
import { Badge } from "@/components/ui/badge";
import { Move3d, Crosshair, Radio } from "lucide-react";
import type { ServoCommand, AimTarget } from "@/lib/use-webcam-pipeline";

/** A dial showing one axis's commanded angle within its travel. */
function Axis({ label, deg, min, max }: { label: string; deg: number; min: number; max: number }) {
  const pct = ((deg - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs">{deg.toFixed(1)}°</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted">
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
        {/* rest position marker */}
        <div className="absolute left-1/2 top-1/2 h-2 w-px -translate-y-1/2 bg-border" />
      </div>
    </div>
  );
}

export function ServoPanel({
  servo,
  target,
  connected,
}: {
  servo: ServoCommand | null;
  target: AimTarget | null;
  connected: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <Move3d className="h-3.5 w-3.5 text-primary" /> Pan / tilt head
        </span>
        {servo !== null && (
          <Badge variant={servo.tracking ? "success" : "default"}>
            {servo.tracking ? "tracking" : "resting"}
          </Badge>
        )}
      </div>

      {servo === null ? (
        <p className="text-xs text-muted-foreground">
          {connected ? "Waiting for the first frame…" : "No camera connected."}
        </p>
      ) : (
        <>
          <Axis label="Pan" deg={servo.pan_deg} min={20} max={160} />
          <Axis label="Tilt" deg={servo.tilt_deg} min={20} max={160} />

          <p className="text-[10px] leading-snug text-muted-foreground">{servo.reason}</p>

          {target !== null && (
            <p className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <Crosshair className="h-3 w-3" />
              aim x {target.x >= 0 ? "+" : ""}
              {target.x.toFixed(2)} y {target.y >= 0 ? "+" : ""}
              {target.y.toFixed(2)} · {(target.area * 100).toFixed(1)}% of frame
            </p>
          )}

          <p className="inline-flex items-center gap-1.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
            <Radio className="h-3 w-3" />
            Commanded angles — no controller attached yet, so nothing is moving.
          </p>
        </>
      )}
    </div>
  );
}
