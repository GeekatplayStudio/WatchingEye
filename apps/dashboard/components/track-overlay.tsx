"use client";

/**
 * Tracking overlay, drawn at display rate.
 *
 * The engine confirms positions at whatever rate the round trip allows;
 * redrawing only on those updates makes boxes visibly step. So each box is
 * extrapolated from its last confirmed position and velocity on every animation
 * frame, and snapped back whenever the engine speaks. The engine remains the
 * only source of truth about *what* is there — this smooths *where* it is
 * between confirmations, and never invents or removes a box.
 */
import { useEffect, useRef, useState } from "react";
import {
  HEADING_ARROWS,
  type AimTarget,
  type PinnedStatus,
  type TrackedRegion,
} from "@/lib/use-webcam-pipeline";

interface Props {
  regions: TrackedRegion[];
  target: AimTarget | null;
  targetId: string | null;
  gridWidth: number;
  gridHeight: number;
  pinnedTarget?: { x: number; y: number } | null;
  pinnedStatus?: PinnedStatus;
}

/** How far ahead extrapolation may run before it is clearly guessing. */
const MAX_EXTRAPOLATION_FRAMES = 2.5;

export function TrackOverlay({
  regions,
  target,
  targetId,
  gridWidth,
  gridHeight,
  pinnedTarget,
  pinnedStatus = "idle",
}: Props) {
  const [, force] = useState(0);
  const receivedAt = useRef(performance.now());
  const latest = useRef(regions);

  useEffect(() => {
    latest.current = regions;
    receivedAt.current = performance.now();
  }, [regions]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Assume the engine is producing roughly 10 fps unless it is faster; this
  // only scales how far a velocity is projected, so being wrong is soft.
  const elapsedFrames = Math.min(
    (performance.now() - receivedAt.current) / 100,
    MAX_EXTRAPOLATION_FRAMES,
  );

  return (
    <div className="pointer-events-none absolute inset-0">
      {latest.current.map((r) => {
        const x = r.bbox.x + r.vx * elapsedFrames;
        const y = r.bbox.y + r.vy * elapsedFrames;
        const isTarget = r.id === targetId;
        const color = isTarget
          ? "hsl(var(--primary))"
          : r.gate_open
            ? "hsl(var(--primary) / 0.6)"
            : "hsl(var(--warning))";
        return (
          <div
            key={r.id}
            className="absolute rounded-sm border-2"
            style={{
              left: `${(x / gridWidth) * 100}%`,
              top: `${(y / gridHeight) * 100}%`,
              width: `${(r.bbox.width / gridWidth) * 100}%`,
              height: `${(r.bbox.height / gridHeight) * 100}%`,
              borderColor: color,
              borderWidth: isTarget ? 3 : 2,
              transition: "none",
            }}
          >
            <span
              className="absolute -top-4 left-0 whitespace-nowrap rounded px-1 text-[10px] font-medium"
              style={{ backgroundColor: color, color: "hsl(var(--background))" }}
            >
              {isTarget ? "◎ TARGET" : r.gate_open ? "tracked" : `${r.seen_frames}`}
              {r.motion !== undefined && r.motion.heading !== "still" && (
                <>
                  {" "}
                  {HEADING_ARROWS[r.motion.heading] ?? ""} {r.motion.speed.toFixed(2)}/s
                </>
              )}
            </span>
          </div>
        );
      })}

      {/* Point Cross Assign reticle.
          While following, it rides the subject's live aim point — the click
          only chose *what* to follow, so leaving the reticle at that
          coordinate would show the operator the wrong thing the moment the
          subject moved. While searching it stays where it was assigned. */}
      {pinnedTarget != null && (
        <div
          className="absolute z-20 flex flex-col items-center"
          style={
            pinnedStatus === "following" && target !== null
              ? {
                  left: `${((target.x + 1) / 2) * 100}%`,
                  top: `${((target.y + 1) / 2) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  transition: "left 90ms linear, top 90ms linear",
                }
              : {
                  left: `${pinnedTarget.x * 100}%`,
                  top: `${pinnedTarget.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                }
          }
        >
          <div className="relative flex items-center justify-center">
            {/* Outer animated pulse ring */}
            <div className="absolute h-12 w-12 rounded-full border border-cyan-400 opacity-75 animate-ping" />
            <svg width="56" height="56" viewBox="0 0 56 56" className="drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]">
              {/* Outer circle */}
              <circle cx="28" cy="28" r="20" fill="none" stroke="#06b6d4" strokeWidth="1.75" strokeDasharray="4 2" />
              {/* Inner ring */}
              <circle cx="28" cy="28" r="10" fill="none" stroke="#06b6d4" strokeWidth="1.25" opacity="0.9" />
              {/* Center point dot */}
              <circle cx="28" cy="28" r="3" fill="#22d3ee" />
              {/* Crosshair lines */}
              <line x1="28" y1="0" x2="28" y2="15" stroke="#06b6d4" strokeWidth="2" />
              <line x1="28" y1="41" x2="28" y2="56" stroke="#06b6d4" strokeWidth="2" />
              <line x1="0" y1="28" x2="15" y2="28" stroke="#06b6d4" strokeWidth="2" />
              <line x1="41" y1="28" x2="56" y2="28" stroke="#06b6d4" strokeWidth="2" />
            </svg>
          </div>
          <span
            className={
              pinnedStatus === "following"
                ? "mt-1 whitespace-nowrap rounded border border-cyan-500/50 bg-cyan-950/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 shadow-md"
                : "mt-1 whitespace-nowrap rounded border border-accent/50 bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent shadow-md"
            }
          >
            {pinnedStatus === "following"
              ? "⊕ FOLLOWING"
              : `⊕ SEARCHING (${(pinnedTarget.x * 100).toFixed(0)}%, ${(pinnedTarget.y * 100).toFixed(0)}%)`}
          </span>
        </div>
      )}

      {/* Crosshair at the aim point the servos are following. */}
      {target !== null && pinnedTarget == null && (
        <div
          className="absolute"
          style={{
            left: `${((target.x + 1) / 2) * 100}%`,
            top: `${((target.y + 1) / 2) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
            <circle
              cx="22"
              cy="22"
              r="13"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              opacity="0.9"
            />
            <line x1="22" y1="0" x2="22" y2="12" stroke="hsl(var(--primary))" strokeWidth="1.5" />
            <line x1="22" y1="32" x2="22" y2="44" stroke="hsl(var(--primary))" strokeWidth="1.5" />
            <line x1="0" y1="22" x2="12" y2="22" stroke="hsl(var(--primary))" strokeWidth="1.5" />
            <line x1="32" y1="22" x2="44" y2="22" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>
  );
}
