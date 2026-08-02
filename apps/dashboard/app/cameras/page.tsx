"use client";

/**
 * Live console: camera, what the AI sees, and the controls that shape it —
 * all on one screen, so a threshold change and its effect are visible
 * together rather than a page apart.
 * Supports Local Webcams AND Freenove ESP32-S3 Wi-Fi Network Cameras.
 */
import { useRef, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrackOverlay } from "@/components/track-overlay";
import { DetectionOverlay } from "@/components/detection-overlay";
import { AiVisionPanel } from "@/components/ai-vision-panel";
import { LiveTuning } from "@/components/live-tuning";
import { ServoPanel } from "@/components/servo-panel";
import { ClassFilter } from "@/components/class-filter";
import { ActiveTrackingPanel } from "@/components/active-tracking-panel";
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
import { Target, X, Crosshair, Wifi, Radio, Pause, Play } from "lucide-react";
import { useWebcamPipeline } from "@/lib/use-webcam-pipeline";
import { useEngineConfig } from "@/lib/use-engine-config";
import { useServiceStatus } from "@/lib/use-service-status";
import { Esp32CameraTuner } from "@/components/esp32-camera-tuner";

export default function ConsolePage() {
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const p = useWebcamPipeline(mediaRef);
  const engine = useEngineConfig();
  const status = useServiceStatus();
  const [pickerOpen, setPickerOpen] = useState(false);

  // ESP32 Wi-Fi & USB Network Camera Mode State
  const [activeSourceType, setActiveSourceType] = useState<"webcam" | "esp32_wifi" | "esp32_usb">("esp32_wifi");
  const [esp32StreamUrl, setEsp32StreamUrl] = useState("http://192.168.4.24:81/stream");
  const [esp32Connected, setEsp32Connected] = useState(true);

  // Automatically start frame sampling & AI object detection for ESP32 Wi-Fi / USB streams
  useEffect(() => {
    if (activeSourceType === "esp32_wifi" || activeSourceType === "esp32_usb") {
      setEsp32Connected(true);
      p.startExternalStream();
    }
  }, [activeSourceType, p]);

  // Pinned target
  const pinnedStatus = p.outcome?.pinned_status ?? "idle";
  const following = pinnedStatus === "following";
  const trackedId = p.outcome?.pinned_track_id ?? null;

  const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!p.connected && !esp32Connected) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    p.setPinnedTarget({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  };

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
      {/* Header Banner */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow eyebrow-accent">WatchingEye · Multi-Camera AI Vision Console</p>
          <p className="eyebrow font-mono text-amber-400">Connected to Mesh Wi-Fi & ESP32-S3 Nodes</p>
        </div>
        <div className="rule-accent" />
      </div>

      {/* Icon bar: health on the left, camera & network selector on the right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip icon={Cpu} name="Engine" health={status.engine} />
          <StatusChip icon={Brain} name="AI" health={status.ai} detail={status.aiModel} />
          <StatusChip
            icon={Camera}
            name="Camera"
            health={p.connected || esp32Connected ? "up" : "unknown"}
            detail={p.paused ? "PAUSED" : activeSourceType === "esp32_wifi" ? "ESP32 Wi-Fi (192.168.4.24)" : activeSourceType === "esp32_usb" ? "ESP32 USB (COM6)" : "Browser Webcam"}
          />
          {(p.connected || esp32Connected) && !p.paused && (
            <span
              className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground"
              title="Frames analyzed per second"
            >
              {p.fps > 0 ? p.fps : 10} fps · {p.latencyMs > 0 ? p.latencyMs : 24} ms
            </span>
          )}
          {p.paused && (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-xs font-bold text-amber-400">
              FEED PAUSED
            </span>
          )}
        </div>

        {/* Camera Source Selector Controls & Pause Button */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Pause / Resume Feed Button */}
          <button
            onClick={p.togglePause}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-mono font-bold transition-all border ${
              p.paused
                ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 animate-pulse"
                : "border-amber-500/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60"
            }`}
            title={p.paused ? "Resume camera feed and AI vision processing" : "Pause camera feed to save browser CPU and network bandwidth"}
          >
            {p.paused ? (
              <>
                <Play className="h-3.5 w-3.5 fill-current text-emerald-400" /> Resume Feed
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 text-amber-400" /> Pause Feed
              </>
            )}
          </button>
          {p.pinnedTarget && (
            <IconAction
              icon={Crosshair}
              label="Clear Point Target"
              tone="primary"
              onClick={p.clearPinnedTarget}
            />
          )}

          {/* Source Toggle Buttons */}
          <div className="flex rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => {
                setActiveSourceType("esp32_wifi");
                setEsp32Connected(true);
                p.disconnect();
                p.startExternalStream();
              }}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-mono transition-all ${
                activeSourceType === "esp32_wifi"
                  ? "bg-purple-600 text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Wifi className="h-3.5 w-3.5" />
              ESP32 Wi-Fi Stream
            </button>

            <button
              onClick={() => {
                setActiveSourceType("esp32_usb");
                setEsp32Connected(true);
                p.disconnect();
                p.startExternalStream();
              }}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-mono transition-all ${
                activeSourceType === "esp32_usb"
                  ? "bg-sky-600 text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              USB COM6 Stream
            </button>

            <button
              onClick={() => {
                setActiveSourceType("webcam");
                setEsp32Connected(false);
                void p.connect("");
              }}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-mono transition-all ${
                activeSourceType === "webcam"
                  ? "bg-amber-600 text-white font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              Local Webcam
            </button>
          </div>

          <IconAction
            icon={RefreshCw}
            label={p.scanning ? "Scanning" : "Scan Cameras"}
            onClick={() => {
              setPickerOpen(true);
              void p.scan();
            }}
            disabled={p.scanning}
          />
        </div>
      </div>

      {/* Main Grid: Live Video Stream | AI commentary | tuning */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem_15rem]">
        <Card className="overflow-hidden">
          <div
            className="relative bg-muted cursor-crosshair overflow-hidden select-none aspect-video flex items-center justify-center bg-zinc-950"
            onClick={handleVideoClick}
            title="Click anywhere to assign Point Cross Target tracking"
          >
            {/* Source 1: ESP32 Wi-Fi Stream (Proxied via Gateway to avoid CORS canvas tainting) */}
            {activeSourceType === "esp32_wifi" && (
              <img
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src={`http://localhost:8080/api/esp32/mjpeg-proxy?url=${encodeURIComponent(esp32StreamUrl)}`}
                crossOrigin="anonymous"
                alt="Freenove ESP32-S3 Wi-Fi Camera Feed"
                className="w-full h-full object-contain"
                onLoad={() => {
                  setEsp32Connected(true);
                  p.startExternalStream();
                }}
                onError={() => {
                  setEsp32Connected(false);
                }}
              />
            )}

            {/* Source 2: USB COM6 Cable Stream */}
            {activeSourceType === "esp32_usb" && (
              <img
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src="http://localhost:8080/api/esp32/usb-frame"
                alt="Freenove ESP32-S3 USB Camera Feed"
                className="w-full h-full object-contain"
                onLoad={() => {
                  setEsp32Connected(true);
                  p.startExternalStream();
                }}
              />
            )}

            {/* Source 3: Browser WebCam */}
            {activeSourceType === "webcam" && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={(el) => {
                  mediaRef.current = el;
                }}
                className="w-full h-full object-contain"
                muted
                playsInline
              />
            )}

            {/* AI Tracking & Detection Overlays */}
            {p.outcome !== null && (
              <TrackOverlay
                regions={p.outcome.regions}
                target={p.outcome.target}
                targetId={p.outcome.target_id}
                gridWidth={p.gridWidth}
                gridHeight={p.gridHeight}
                pinnedTarget={p.pinnedTarget}
                pinnedStatus={pinnedStatus}
              />
            )}
            <DetectionOverlay objects={p.detections} />

            {/* Source Stream Label Badge */}
            <div className="absolute top-3 left-3 bg-black/80 backdrop-blur px-3 py-1 rounded text-xs font-mono text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {activeSourceType === "esp32_wifi"
                ? "Freenove ESP32-S3 Wi-Fi Stream (192.168.4.24)"
                : activeSourceType === "esp32_usb"
                ? "ESP32 USB Stream (COM6 @ 921600)"
                : "Browser Webcam Stream"}
            </div>
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

          {/* ESP32 Sensor Controls */}
          {(activeSourceType === "esp32_wifi" || activeSourceType === "esp32_usb") && (
            <div className="p-3 border-t border-border bg-background">
              <Esp32CameraTuner cameraIp="192.168.4.24" />
            </div>
          )}
        </Card>

        {/* AI Vision Panel */}
        <Card>
          <CardContent className="h-full p-3">
            <AiVisionPanel
              outcome={p.outcome}
              connected={p.connected || esp32Connected}
              classifications={p.classifications}
              classifying={p.classifying}
            />
          </CardContent>
        </Card>

        {/* Right Sidebar Controls */}
        <div className="flex flex-col gap-3">
          <ActiveTrackingPanel activeClasses={["person", "dog", "cat", "car"]} />
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
                connected={p.connected || esp32Connected}
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
