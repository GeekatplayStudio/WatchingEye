"use client";

/**
 * Connect one RTSP stream into the live pipeline and watch it track.
 *
 * This is the same deterministic engine the browser webcam drives — motion,
 * tracking, gating — fed by the network camera instead. The preview renders
 * the exact grid of samples the engine analysed, upscaled, with the same
 * `TrackOverlay` the Console page uses: what you see here is what the
 * algorithm saw, not a nicer stand-in for it.
 *
 * Credentials are their own short-lived form, separate from the ONVIF
 * inventory step above it — that step already forgets its password once
 * used, so testing the stream needs its own, used the same way.
 */
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrackOverlay } from "@/components/track-overlay";
import { HEADING_ARROWS } from "@/lib/use-webcam-pipeline";
import { useNetworkCamera } from "@/lib/use-network-camera";
import { Play, Square } from "lucide-react";

/** Turn a bare `rtsp://host/path` into one carrying credentials. */
function withCredentials(url: string, user: string, password: string): string {
  const at = url.indexOf("://");
  if (at === -1) return url;
  const scheme = url.slice(0, at + 3);
  const rest = url.slice(at + 3);
  // A URL already carrying a `user:pass@` is left alone rather than
  // double-embedding a second set of credentials in front of it.
  if (rest.includes("@")) return url;
  return `${scheme}${encodeURIComponent(user)}:${encodeURIComponent(password)}@${rest}`;
}

export function NetworkCameraTest({ streamUrl, suggestedId }: { streamUrl: string; suggestedId: string }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const cam = useNetworkCamera(suggestedId);

  const start = async () => {
    await cam.connect(withCredentials(streamUrl, user, password));
    setPassword("");
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Play className="h-3.5 w-3.5" />
        Test in pipeline
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-3">
      {!cam.connected ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="eyebrow" id={`${formId}-user-label`}>
              User
            </span>
            <input
              aria-labelledby={`${formId}-user-label`}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="off"
              className="h-8 w-32 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow" id={`${formId}-pw-label`}>
              Password
            </span>
            <input
              aria-labelledby={`${formId}-pw-label`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="h-8 w-36 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <Button type="submit" variant="accent" size="sm" disabled={cam.connecting}>
            <Play className="h-3.5 w-3.5" />
            {cam.connecting ? "Connecting…" : "Connect"}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="font-mono text-[0.65rem] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="success">live</Badge>
              <span className="font-mono text-[0.7rem] text-muted-foreground">{suggestedId}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void cam.disconnect();
                setOpen(false);
              }}
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          </div>

          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-sm border border-border bg-black">
            <canvas
              ref={cam.canvasRef}
              className="block w-full"
              style={{ aspectRatio: `${cam.gridWidth} / ${cam.gridHeight}` }}
            />
            {cam.outcome !== null && (
              <TrackOverlay
                regions={cam.outcome.regions}
                target={cam.outcome.target}
                targetId={cam.outcome.target_id}
                gridWidth={cam.gridWidth}
                gridHeight={cam.gridHeight}
              />
            )}
          </div>

          {cam.outcome !== null && (
            <p className="font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
              frame {cam.outcome.frame} · {cam.outcome.motion ? "motion" : "static"} (
              {(cam.outcome.changed_ratio * 100).toFixed(1)}%) · {cam.outcome.regions.length} region
              {cam.outcome.regions.length === 1 ? "" : "s"}
              {cam.outcome.regions.length > 0 && (
                <>
                  {" "}
                  {cam.outcome.regions
                    .map((r) => HEADING_ARROWS[r.motion.heading] ?? "")
                    .filter((a) => a !== "")
                    .join(" ")}
                </>
              )}
            </p>
          )}
        </div>
      )}

      {cam.error !== null && (
        <p className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-1.5 font-mono text-[0.7rem] text-danger">
          {cam.error}
        </p>
      )}
    </div>
  );
}
