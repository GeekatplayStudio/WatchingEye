"use client";

/**
 * Webcam capture → Rust vision engine → overlay.
 *
 * The browser only captures and renders. Every decision (motion, regions,
 * identity, gating) is made by the Rust engine; this hook never infers
 * anything locally, so what you see on screen is exactly what the
 * deterministic core concluded.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Sample grid sent to the engine. Small on purpose — the engine works on
 *  luminance, and this keeps the round trip well under a frame budget. */
const GRID_WIDTH = 96;
const GRID_HEIGHT = 72;

/** A region the engine is tracking. */
export interface TrackedRegion {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  seen_frames: number;
  missed_frames: number;
  gate_open: boolean;
}

/** Everything the engine concluded about one frame. */
export interface FrameOutcome {
  frame: number;
  motion: boolean;
  changed_ratio: number;
  regions: TrackedRegion[];
  triggered: string[];
  rejected_reason: string | null;
  trace: string[];
}

/** A camera the browser can see. */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

interface PipelineState {
  devices: CameraDevice[];
  scanning: boolean;
  connected: boolean;
  error: string | null;
  outcome: FrameOutcome | null;
  fps: number;
}

/**
 * Drive the capture loop.
 *
 * `scan()` enumerates cameras (labels appear only after permission is
 * granted, which is why connecting also re-scans). `connect(deviceId)`
 * triggers the browser's own permission prompt — the app never bypasses it.
 */
export function useWebcamPipeline(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<PipelineState>({
    devices: [],
    scanning: false,
    connected: false,
    error: null,
    outcome: null,
    fps: 0,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(false);
  const framesRef = useRef<number[]>([]);

  const scan = useCallback(async () => {
    setState((s) => ({ ...s, scanning: true, error: null }));
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        throw new Error("This browser exposes no camera API (needs HTTPS or localhost).");
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label !== "" ? d.label : `Camera ${i + 1} (allow access to see name)`,
        }));
      setState((s) => ({ ...s, devices, scanning: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        scanning: false,
        error: err instanceof Error ? err.message : "camera scan failed",
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => ({ ...s, connected: false, outcome: null, fps: 0 }));
  }, []);

  const connect = useCallback(
    async (deviceId: string) => {
      setState((s) => ({ ...s, error: null }));
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId === "" ? true : { deviceId: { exact: deviceId } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setState((s) => ({ ...s, connected: true }));
        void scan(); // labels are only readable once permission is granted
        runningRef.current = true;
        void captureLoop();
      } catch (err) {
        setState((s) => ({
          ...s,
          error:
            err instanceof Error
              ? `Could not open camera: ${err.message}`
              : "could not open camera",
        }));
      }
    },
    // captureLoop is stable via refs; scan is memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, videoRef],
  );

  const captureLoop = useCallback(async () => {
    if (canvasRef.current === null) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = GRID_WIDTH;
      canvasRef.current.height = GRID_HEIGHT;
    }
    const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true });
    while (runningRef.current) {
      const video = videoRef.current;
      if (ctx === null || video === null || video.videoWidth === 0) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      ctx.drawImage(video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
      const { data } = ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
      const samples = new Array<number>(GRID_WIDTH * GRID_HEIGHT);
      for (let i = 0; i < samples.length; i += 1) {
        const o = i * 4;
        // Rec. 601 luma — the engine works on brightness only.
        samples[i] =
          (0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0)) | 0;
      }
      try {
        const res = await fetch("/engine/api/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id: "webcam",
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            samples,
          }),
        });
        if (!res.ok) throw new Error(`engine ${res.status}`);
        const outcome = (await res.json()) as FrameOutcome;
        const now = performance.now();
        framesRef.current = [...framesRef.current, now].filter((t) => now - t < 1000);
        setState((s) => ({ ...s, outcome, fps: framesRef.current.length, error: null }));
      } catch (err) {
        setState((s) => ({
          ...s,
          error:
            err instanceof Error
              ? `Vision engine unreachable (${err.message}). Start it with: cargo run -p vision-engine`
              : "engine error",
        }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }, [videoRef]);

  useEffect(() => () => disconnect(), [disconnect]);

  return { ...state, scan, connect, disconnect, gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT };
}
