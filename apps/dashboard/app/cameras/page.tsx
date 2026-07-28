"use client";

/**
 * Live console: camera, what the AI sees, and the controls that shape it —
 * all on one screen, so a threshold change and its effect are visible
 * together rather than a page apart.
 */
import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrackOverlay } from "@/components/track-overlay";
import { DetectionOverlay } from "@/components/detection-overlay";
import { AiVisionPanel } from "@/components/ai-vision-panel";
import { LiveTuning } from "@/components/live-tuning";
import { ServoPanel } from "@/components/servo-panel";
import { ClassFilter } from "@/components/class-filter";
import {
  StatusChip,
  IconAction,
  Camera,
  Cpu,
  Brain,
  RefreshCw,
  Unplug,
  Plug,
} from "@/components/status-bar";
import { useWebcamPipeline } from "@/lib/use-webcam-pipeline";
import { useEngineConfig } from "@/lib/use-engine-config";
import { useServiceStatus } from "@/lib/use-service-status";

export default function ConsolePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const p = useWebcamPipeline(videoRef);
  const engine = useEngineConfig();
  const status = useServiceStatus();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
      {/* Icon bar: health on the left, camera controls on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip icon={Cpu} name="Engine" health={status.engine} />
          <StatusChip icon={Brain} name="AI" health={status.ai} detail={status.aiModel} />
          <StatusChip icon={Camera} name="Camera" health={p.connected ? "up" : "unknown"} />
          {p.connected && (
            <span
              className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground"
              title="Frames analyzed per second, and engine round-trip latency"
            >
              {p.fps} fps · {p.latencyMs} ms
            </span>
          )}
          {p.connected && p.detectError === null && p.detections.length >= 0 && (
            <span
              className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground"
              title="Full-frame YOLO pass: objects currently identified, and its round trip"
            >
              {p.detections.length} obj · {p.detectLatencyMs} ms
            </span>
          )}
          {p.detectError !== null && (
            <span className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger">
              detector: {p.detectError}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <IconAction
            icon={RefreshCw}
            label={p.scanning ? "Scanning" : "Scan"}
            onClick={() => {
              setPickerOpen(true);
              void p.scan();
            }}
            disabled={p.scanning}
          />
          {p.connected ? (
            <IconAction icon={Unplug} label="Disconnect" tone="danger" onClick={p.disconnect} />
          ) : (
            <IconAction
              icon={Plug}
              label="Connect camera"
              tone="primary"
              onClick={() => void p.connect("")}
            />
          )}
        </div>
      </div>

      {p.error !== null && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {p.error}
        </p>
      )}

      {pickerOpen && !p.connected && p.devices.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-xs text-muted-foreground">Pick a camera:</span>
            {p.devices.map((d) => (
              <IconAction
                key={d.deviceId}
                icon={Camera}
                label={d.label}
                tone="primary"
                onClick={() => {
                  setPickerOpen(false);
                  void p.connect(d.deviceId);
                }}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* video | AI commentary | tuning — one glance covers all three */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem_15rem]">
        <Card className="overflow-hidden">
          <div className="relative bg-muted">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="w-full" muted playsInline />
            {p.outcome !== null && (
              <TrackOverlay
                regions={p.outcome.regions}
                target={p.outcome.target}
                targetId={p.outcome.target_id}
                gridWidth={p.gridWidth}
                gridHeight={p.gridHeight}
              />
            )}
            {p.connected && <DetectionOverlay objects={p.detections} />}
            {!p.connected && (
              <div className="flex aspect-video flex-col items-center justify-center gap-2">
                <Camera className="h-8 w-8 text-muted-foreground" />
                <p className="max-w-xs text-center text-xs text-muted-foreground">
                  Connect a camera to begin. Your browser will ask permission — nothing is
                  captured until you allow it.
                </p>
              </div>
            )}
          </div>
          {p.outcome !== null && (
            <CardContent className="p-2">
              <ol className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                {p.outcome.trace.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardContent className="h-full p-3">
            <AiVisionPanel
              outcome={p.outcome}
              connected={p.connected}
              classifications={p.classifications}
              classifying={p.classifying}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <CardContent className="p-3">
              <ClassFilter />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <ServoPanel
                servo={p.outcome?.servo ?? null}
                target={p.outcome?.target ?? null}
                connected={p.connected}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <LiveTuning
                config={engine.config}
                update={engine.update}
                saving={engine.saving}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
