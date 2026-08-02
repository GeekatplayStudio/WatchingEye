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

export interface ExtendedDetectedObject extends DetectedObject {
  identityName?: string;
  actionTag?: string;
}

export function DetectionOverlay({ objects }: { objects: ExtendedDetectedObject[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {objects.map((o, i) => {
        const dimmed = o.filtered === true;
        const color = o.identityName
          ? "hsl(140 85% 55%)"
          : o.actionTag
          ? "hsl(40 95% 55%)"
          : dimmed
          ? "hsl(var(--muted-foreground) / 0.5)"
          : "hsl(200 90% 60%)";

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
              borderWidth: 2,
            }}
            title={o.distance?.basis}
          >
            {/* Top Identity & Action Badge */}
            <div className="absolute -top-5 left-0 flex flex-wrap gap-1">
              {o.identityName && (
                <span className="rounded bg-emerald-500 px-1 py-0.5 font-mono text-[9px] font-bold text-black uppercase shadow">
                  ID: {o.identityName}
                </span>
              )}
              {o.actionTag && (
                <span className="rounded bg-amber-500 px-1 py-0.5 font-mono text-[9px] font-bold text-black uppercase shadow">
                  ACT: {o.actionTag}
                </span>
              )}
            </div>

            {/* Bottom Object Class & Confidence */}
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
