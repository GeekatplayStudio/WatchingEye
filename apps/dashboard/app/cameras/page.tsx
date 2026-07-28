"use client";

/**
 * Cameras: scan for devices, connect one, and watch the deterministic
 * pipeline track what it sees — with the per-frame reasoning shown beside
 * the video, never hidden behind it.
 */
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWebcamPipeline } from "@/lib/use-webcam-pipeline";
import { TrackOverlay } from "@/components/track-overlay";
import { Camera, RefreshCw, Plug, PlugZap } from "lucide-react";

export default function CamerasPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const p = useWebcamPipeline(videoRef);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Cameras</h1>
        <div className="flex items-center gap-2">
          {p.classifying && <Badge variant="warning">classifying…</Badge>}
          {p.connected && <Badge variant="success">{p.fps} fps analyzed</Badge>}
          <Button variant="outline" size="sm" onClick={() => void p.scan()} disabled={p.scanning}>
            <RefreshCw className="h-3.5 w-3.5" />
            {p.scanning ? "Scanning…" : "Scan for cameras"}
          </Button>
          {p.connected && (
            <Button variant="outline" size="sm" onClick={p.disconnect}>
              <PlugZap className="h-3.5 w-3.5" /> Disconnect
            </Button>
          )}
        </div>
      </div>

      {p.error !== null && (
        <Card>
          <CardContent className="p-4 text-sm text-danger">{p.error}</CardContent>
        </Card>
      )}

      {!p.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Available devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.devices.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No cameras listed yet. Click <strong>Scan for cameras</strong>, then connect —
                your browser will ask for permission. Nothing is captured until you allow it.
              </p>
            )}
            {p.devices.map((d) => (
              <div
                key={d.deviceId}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Camera className="h-4 w-4 text-primary" />
                  {d.label}
                </span>
                <Button size="sm" onClick={() => void p.connect(d.deviceId)}>
                  <Plug className="h-3.5 w-3.5" /> Connect
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => void p.connect("")}>
              Or connect the default camera
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Live view with tracked regions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-hidden rounded-md bg-muted">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="w-full" muted playsInline />
              {p.outcome !== null && (
                <TrackOverlay
                  regions={p.outcome.regions}
                  gridWidth={p.gridWidth}
                  gridHeight={p.gridHeight}
                />
              )}
              {!p.connected && (
                <div className="flex aspect-video items-center justify-center">
                  <Camera className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Boxes are drawn from the Rust engine&apos;s output only. The browser captures and
              renders; it never decides what is there.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline trace (this frame)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.outcome === null ? (
              <p className="text-sm text-muted-foreground">Connect a camera to see reasoning.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={p.outcome.motion ? "warning" : "default"}>
                    {p.outcome.motion ? "motion" : "static"}
                  </Badge>
                  <Badge variant="outline">frame {p.outcome.frame}</Badge>
                  <Badge variant="outline">
                    {(p.outcome.changed_ratio * 100).toFixed(2)}% foreground
                  </Badge>
                </div>
                <ol className="space-y-1 font-mono text-xs text-muted-foreground">
                  {p.outcome.trace.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <div>
                  <p className="mb-1 text-sm font-medium">
                    Tracked objects ({p.outcome.regions.length})
                  </p>
                  {p.outcome.regions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nothing tracked. Move in front of the camera — a still object is absorbed
                      into the background model by design.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {p.outcome.regions.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-xs">
                        <span className="font-mono">{r.id.slice(0, 8)}</span>
                        <Badge variant={r.gate_open ? "success" : "default"}>
                          {r.gate_open ? "gate open" : `${r.seen_frames}/3 frames`}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recognized objects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {p.classifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recognized yet. A vision model is consulted only when the trigger gate
              opens on a tracked object — never per frame.
            </p>
          ) : (
            p.classifications.map((c) => (
              <div key={`${c.objectId}-${c.at}`} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">{c.label}</span>
                  {c.rejectedReason === undefined ? (
                    <Badge variant={c.confidence >= 0.95 ? "success" : "warning"}>
                      {(c.confidence * 100).toFixed(1)}%
                    </Badge>
                  ) : (
                    <Badge variant="danger">refused by guardrails</Badge>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.objectId.slice(0, 8)}
                  </span>
                </div>
                {c.evidence.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.evidence.map((e) => (
                      <Badge key={e.label} title={e.description}>
                        {e.label.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                )}
                {c.rejectedReason !== undefined && (
                  <p className="mt-1 text-xs text-danger">{c.rejectedReason}</p>
                )}
                <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                  {c.model}
                  {c.promptVersion !== undefined ? ` · ${c.promptVersion}` : ""}
                  {c.latencyMs !== undefined ? ` · ${(c.latencyMs / 1000).toFixed(1)}s` : ""} ·{" "}
                  {new Date(c.at).toLocaleTimeString()}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
