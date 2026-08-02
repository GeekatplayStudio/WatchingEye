"use client";

/**
 * Labels from the full-frame detector, drawn over the video.
 *
 * Distinct from the motion-tracking overlay on purpose: these boxes come
 * from YOLO looking at the whole snapshot, so they persist for stationary
 * objects the motion pipeline cannot see. Unchecked classes are dimmed, not
 * hidden — the detection still happened.
 */
import type { DetectedObject } from "@/lib/use-webcam-pipeline";

export function DetectionOverlay({ objects }: { objects: DetectedObject[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {objects.map((o, i) => {
        const dimmed = o.filtered === true;
        const color = dimmed ? "hsl(var(--muted-foreground) / 0.5)" : "hsl(200 90% 60%)";
        const distance =
          o.distance && o.distance !== null
            ? ` · ~${o.distance.metres < 10 ? o.distance.metres.toFixed(1) : o.distance.metres.toFixed(0)}m`
            : "";
        return (
          <div
            key={`${o.cocoLabel}-${i}`}
            className="absolute rounded-sm border"
            style={{
              left: `${o.bbox.x * 100}%`,
              top: `${o.bbox.y * 100}%`,
              width: `${o.bbox.width * 100}%`,
              height: `${o.bbox.height * 100}%`,
              borderColor: color,
              borderStyle: dimmed ? "dashed" : "solid",
              borderWidth: 1.5,
            }}
            title={o.distance?.basis}
          >
            <span
              className="absolute -bottom-4 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium"
              style={{
                backgroundColor: color,
                color: "hsl(var(--background))",
                opacity: dimmed ? 0.7 : 1,
              }}
            >
              {o.class} {(o.confidence * 100).toFixed(0)}%{distance}
              {dimmed ? " (not alerting)" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
