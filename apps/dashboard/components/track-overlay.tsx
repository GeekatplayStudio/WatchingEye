"use client";

/**
 * Draws the engine's tracked regions over the video.
 *
 * Coordinates arrive in the engine's sample grid and are converted to
 * percentages, so the overlay stays aligned at any rendered video size.
 */
import type { TrackedRegion } from "@/lib/use-webcam-pipeline";

interface Props {
  regions: TrackedRegion[];
  gridWidth: number;
  gridHeight: number;
}

export function TrackOverlay({ regions, gridWidth, gridHeight }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {regions.map((r) => {
        const style = {
          left: `${(r.bbox.x / gridWidth) * 100}%`,
          top: `${(r.bbox.y / gridHeight) * 100}%`,
          width: `${(r.bbox.width / gridWidth) * 100}%`,
          height: `${(r.bbox.height / gridHeight) * 100}%`,
        };
        const color = r.gate_open ? "hsl(var(--primary))" : "hsl(var(--warning))";
        return (
          <div
            key={r.id}
            className="absolute rounded-sm border-2"
            style={{ ...style, borderColor: color }}
          >
            <span
              className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium"
              style={{ backgroundColor: color, color: "hsl(var(--background))" }}
            >
              {r.id.slice(0, 6)} · {r.gate_open ? "tracked" : `${r.seen_frames}/3`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
