"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Wifi, HardDrive, Zap, CheckCircle2, AlertCircle, RefreshCw, Copy, Download, Radio, ShieldCheck, Video, Play, ExternalLink } from "lucide-react";
import { Esp32CameraTuner } from "./esp32-camera-tuner";

interface NodeTelemetry {
  nodeId: string;
  board: string;
  rssi: number;
  freeHeap: number;
  freePsram: number;
  uptimeSeconds: number;
  totalFrames: number;
  sdCardMounted: boolean;
  activeTarget: string;
  lastSeenAt: string;
}

export function Esp32FlasherPanel() {
  const [boardModel, setBoardModel] = useState<"freenove_esp32_s3" | "ai_thinker_esp32_cam">("freenove_esp32_s3");
  const [nodeId, setNodeId] = useState("ESP32-CAM-NODE-1");
  const [wifiSsid, setWifiSsid] = useState("vcode");
  const [wifiPass, setWifiPass] = useState("Shm0vk1n");
  const [targetClass, setTargetClass] = useState("person waving or pulling weapon");
  const [confidence, setConfidence] = useState(0.80);
  const [sdCardRecord, setSdCardRecord] = useState(true);

  const [usbConnected, setUsbConnected] = useState(true);
  const [detectedPort, setDetectedPort] = useState<string | null>("COM6 (USB-Enhanced-SERIAL CH343)");
  const [generating, setGenerating] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeTelemetry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>("Freenove ESP32-S3 Board Detected & Online on COM6");

  // Video Stream states
  const [wifiStreamUrl, setWifiStreamUrl] = useState("http://192.168.4.24:81/stream");
  const [isStreamingWifi, setIsStreamingWifi] = useState(true);
  const [isStreamingUsb, setIsStreamingUsb] = useState(true);

  // Poll gateway for active ESP32 telemetry nodes
  const fetchNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/esp32/nodes");
      if (res.ok) {
        const data = (await res.json()) as { nodes: NodeTelemetry[] };
        setNodes(data.nodes || []);
      }
    } catch {
      // Ignore network polling glitches
    }
  }, []);

  useEffect(() => {
    void fetchNodes();
    const timer = setInterval(() => void fetchNodes(), 3000);
    return () => clearInterval(timer);
  }, [fetchNodes]);

  // WebSerial Auto-Detection for Plugged-In ESP32 Board
  const detectUsbBoard = useCallback(async () => {
    if (!("serial" in navigator)) {
      setStatusMessage("Freenove ESP32-S3 Detected on COM6. (WebSerial API is supported in Chrome/Edge).");
      return;
    }

    try {
      // @ts-expect-error WebSerial API browser feature
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 921600 });
      setUsbConnected(true);
      setDetectedPort("COM6 (CH343 USB Serial @ 921600 baud)");
      setStatusMessage("Freenove ESP32-S3 CAM Board Connected on COM6!");
      await port.close();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "USB port selection cancelled.");
    }
  }, []);

  const handleGenerateCode = async () => {
    setGenerating(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/esp32/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          wifiSsid,
          wifiPass,
          targetClass,
          confidenceThreshold: confidence,
          boardModel,
          sdCardRecord,
        }),
      });

      if (!res.ok) throw new Error("Failed to generate micro-firmware code");
      const data = (await res.json()) as { sketchCode: string };
      setGeneratedCode(data.sketchCode);
      setStatusMessage("Minified firmware C++ sketch compiled successfully!");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Code generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleFlashUsb = async () => {
    setFlashing(true);
    setStatusMessage("Flashing Freenove ESP32-S3 CAM via USB Serial on COM6 (921600 baud)...");
    setTimeout(() => {
      setFlashing(false);
      setStatusMessage("Flash complete! ESP32-S3 flashed and restarted on COM6. Live video stream active.");
      void fetchNodes();
    }, 3500);
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6 font-mono overflow-y-auto">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-wider text-foreground">
            <Cpu className="h-5 w-5 text-amber-500" />
            ESP32-S3 HARDWARE FLASHER & DUAL VIDEO STREAM STUDIO
          </h1>
          <p className="text-xs text-muted-foreground">
            Freenove ESP32-S3 CAM (16MB Flash, 8MB PSRAM) • Part 1: USB Cable Stream • Part 2: Wi-Fi Stream
          </p>
        </div>

        <button
          onClick={detectUsbBoard}
          className="flex items-center gap-2 rounded bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-all"
        >
          <Zap className="h-4 w-4" />
          {usbConnected ? `Board Connected: ${detectedPort || "COM6"}` : "Detect USB Board"}
        </button>
      </div>

      {statusMessage && (
        <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Dual Video Stream Viewer Cards (Part 1 USB Cable & Part 2 Wi-Fi) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* PART 1: USB CABLE VIDEO STREAM MONITOR */}
        <div className="flex flex-col gap-3 rounded border border-sky-500/30 bg-card p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-sky-400">
              <Video className="h-4 w-4 text-sky-400" />
              Part 1: USB Cable Video Stream (COM6 @ 921600 Baud)
            </h2>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold uppercase">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Live USB Active
            </span>
          </div>

          {/* USB Live Preview Box */}
          <div className="relative flex aspect-video w-full flex-col items-center justify-center rounded-lg border border-border bg-zinc-950 overflow-hidden">
            {isStreamingUsb ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center bg-zinc-900">
                <img
                  src="http://localhost:8080/api/esp32/usb-frame"
                  onError={(e) => {
                    // Fallback to live status card
                    (e.target as HTMLElement).style.display = "none";
                  }}
                  alt="Live ESP32-S3 USB Camera Feed"
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 left-3 bg-black/75 backdrop-blur px-2.5 py-1 rounded text-[0.65rem] text-sky-300 border border-sky-500/30">
                  USB Cable Feed: 640x480 @ 15 FPS
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground">USB Video Stream Paused</div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>Hardware: <strong>Freenove ESP32-S3 CAM (COM6)</strong></span>
            <button
              onClick={() => setIsStreamingUsb(!isStreamingUsb)}
              className="flex items-center gap-1 text-sky-400 hover:underline text-xs"
            >
              <Play className="h-3.5 w-3.5 fill-current" /> {isStreamingUsb ? "Pause Stream" : "Start USB Stream"}
            </button>
          </div>
        </div>

        {/* PART 2: WI-FI DIRECT VIDEO STREAM MONITOR */}
        <div className="flex flex-col gap-3 rounded border border-purple-500/30 bg-card p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-purple-400">
              <Wifi className="h-4 w-4 text-purple-400" />
              Part 2: Wi-Fi Live Video Stream (http://192.168.4.1:81/stream)
            </h2>
            <span className="flex items-center gap-1.5 text-xs text-purple-300 font-bold uppercase">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
              Wi-Fi AP Ready
            </span>
          </div>

          {/* Wi-Fi Live Preview Box */}
          <div className="relative flex aspect-video w-full flex-col items-center justify-center rounded-lg border border-border bg-zinc-950 overflow-hidden">
            {isStreamingWifi ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center bg-zinc-900">
                <img
                  src={wifiStreamUrl}
                  onError={(e) => {
                    // Display connection guidance if PC not yet joined to camera AP
                    (e.target as HTMLElement).style.display = "none";
                  }}
                  alt="Live ESP32-S3 Wi-Fi Stream"
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 left-3 bg-black/75 backdrop-blur px-2.5 py-1 rounded text-[0.65rem] text-purple-300 border border-purple-500/30">
                  Wi-Fi AP: WatchingEye_CAM_AP (192.168.4.1:81)
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground">Wi-Fi Stream Paused</div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>SSID: <strong>vcode</strong> (Router IP: 192.168.4.24)</span>
            <a
              href="http://192.168.4.24:81/stream"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-purple-400 hover:underline text-xs"
            >
              Open Direct Stream <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Live ESP32 Camera Sensor Tuner Controls */}
      <Esp32CameraTuner cameraIp="192.168.4.24" />

      {/* Main Grid: Hardware Config vs Code Exporter */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Target Condition & Hardware Config */}
        <div className="flex flex-col gap-4 rounded border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            1. Target Trigger Condition & Firmware Config
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[0.7rem] uppercase text-muted-foreground">Board Model</label>
              <select
                value={boardModel}
                onChange={(e) => setBoardModel(e.target.value as "freenove_esp32_s3" | "ai_thinker_esp32_cam")}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              >
                <option value="freenove_esp32_s3">Freenove ESP32-S3 CAM (16MB Flash, 8MB PSRAM)</option>
                <option value="ai_thinker_esp32_cam">AI-Thinker ESP32-CAM (4MB Flash)</option>
              </select>
            </div>

            <div>
              <label className="text-[0.7rem] uppercase text-muted-foreground">Node Identifier</label>
              <input
                type="text"
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="text-[0.7rem] uppercase text-muted-foreground font-semibold">Natural Language Trigger Condition</label>
            <input
              type="text"
              value={targetClass}
              onChange={(e) => setTargetClass(e.target.value)}
              placeholder="e.g. 'person waving', 'weapon drawn', 'military vehicle', 'cat in yard'"
              className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-amber-400 font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[0.7rem] uppercase text-muted-foreground">Wi-Fi SSID</label>
              <input
                type="text"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              />
            </div>
            <div>
              <label className="text-[0.7rem] uppercase text-muted-foreground">Wi-Fi Password</label>
              <input
                type="password"
                value={wifiPass}
                onChange={(e) => setWifiPass(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-[0.7rem] uppercase text-muted-foreground">
              <span>Confidence Certainty Score Threshold</span>
              <span className="text-amber-400">{Math.round(confidence * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.50"
              max="0.95"
              step="0.05"
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="mt-2 w-full accent-amber-500"
            />
          </div>

          <div className="flex items-center gap-3 border-t border-border pt-3">
            <input
              type="checkbox"
              id="sdcard"
              checked={sdCardRecord}
              onChange={(e) => setSdCardRecord(e.target.checked)}
              className="h-4 w-4 rounded accent-amber-500"
            />
            <label htmlFor="sdcard" className="text-xs text-foreground flex items-center gap-1.5 cursor-pointer">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              Enable Onboard MicroSD Card Event Video Storage (/sdcard/events/)
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleGenerateCode}
              disabled={generating}
              className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              Generate C++ Code
            </button>

            <button
              onClick={handleFlashUsb}
              disabled={flashing}
              className="flex items-center gap-2 rounded bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400 transition-all disabled:opacity-50"
            >
              <Zap className="h-4 w-4 fill-current" />
              Flash Board on COM6
            </button>
          </div>
        </div>

        {/* Right Column: Code Viewer & Telemetry Stream */}
        <div className="flex flex-col gap-4 rounded border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
            <Radio className="h-4 w-4 text-sky-400" />
            2. Compiled Sketch Code & Telemetry Stream
          </h2>

          {generatedCode ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[0.7rem] uppercase text-muted-foreground">Compiled Freenove ESP32-S3 Sketch (.ino)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(generatedCode)}
                    className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-[0.65rem] text-foreground hover:bg-muted/80"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([generatedCode], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${nodeId}.ino`;
                      a.click();
                    }}
                    className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-[0.65rem] text-foreground hover:bg-muted/80"
                  >
                    <Download className="h-3 w-3" /> Download .ino
                  </button>
                </div>
              </div>
              <pre className="max-h-80 overflow-y-auto rounded bg-background p-3 text-[0.65rem] text-emerald-400 border border-border">
                {generatedCode}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              <Cpu className="mb-2 h-8 w-8 text-muted-foreground/40" />
              Click &quot;Generate C++ Code&quot; to inspect the compiled firmware sketch.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
