"use client";

/**
 * Webcam capture → Rust vision engine → overlay.
 * Supports HTMLVideoElement (Webcam) AND HTMLImageElement (ESP32 Wi-Fi / USB MJPEG Streams).
 * Optimized frame rate throttling & browser resource management.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const GRID_WIDTH = 96;
export const GRID_HEIGHT = 72;

export interface TrackedRegion {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  seen_frames: number;
  missed_frames: number;
  gate_open: boolean;
  vx: number;
  vy: number;
  motion: {
    heading: string;
    speed: number;
    angle_deg: number;
  };
}

export const HEADING_ARROWS: Record<string, string> = {
  still: "•",
  up: "↑",
  up_right: "↗",
  right: "→",
  down_right: "↘",
  down: "↓",
  down_left: "↙",
  left: "←",
  up_left: "↖",
};

export interface AimTarget {
  x: number;
  y: number;
  area: number;
}

export interface ServoCommand {
  pan_deg: number;
  tilt_deg: number;
  tracking: boolean;
  reason: string;
}

export interface FrameOutcome {
  frame: number;
  motion: boolean;
  changed_ratio: number;
  regions: TrackedRegion[];
  triggered: string[];
  rejected_reason: string | null;
  trace: string[];
  target: AimTarget | null;
  servo: ServoCommand;
  target_id: string | null;
  pinned_target: [number, number] | null;
  pinned_status: PinnedStatus;
  pinned_track_id: string | null;
}

export type PinnedStatus = "idle" | "following" | "searching";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface IdentityInfo {
  id: string;
  name: string | null;
  isNew: boolean;
  sightings: number;
  score?: number;
  matched?: string[];
  quality?: "strong" | "ambiguous" | "weak";
  status?: "tentative" | "confirmed";
  ambiguous?: boolean;
  cameraId?: string;
  crossedCamera?: boolean;
  camerasSeen?: string[];
}

export interface Classification {
  objectId: string;
  label: string;
  confidence: number;
  evidence: Array<{ label: string; description: string }>;
  model: string;
  promptVersion?: string;
  rejectedReason?: string;
  latencyMs?: number;
  identity?: IdentityInfo;
  descriptors?: Array<{ key: string; value: string }>;
  at: string;
}

export interface DetectedObject {
  class: string;
  cocoLabel: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  distance?: { metres: number; basis?: string } | null;
  filtered?: boolean;
}

export interface WebcamPipelineState {
  connected: boolean;
  paused: boolean;
  devices: CameraDevice[];
  scanning: boolean;
  error: string | null;
  outcome: FrameOutcome | null;
  fps: number;
  latencyMs: number;
  classifications: Classification[];
  classifying: boolean;
  pinnedTarget: { x: number; y: number } | null;
  detections: DetectedObject[];
  detectLatencyMs: number;
  detectError: string | null;
}

export function useWebcamPipeline(
  mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>,
) {
  const [state, setState] = useState<WebcamPipelineState>({
    connected: false,
    paused: false,
    devices: [],
    scanning: false,
    error: null,
    outcome: null,
    fps: 0,
    latencyMs: 0,
    classifications: [],
    classifying: false,
    pinnedTarget: null,
    detections: [],
    detectLatencyMs: 0,
    detectError: null,
  });

  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameAtRef = useRef<number>(0);
  const framesRef = useRef<number[]>([]);
  const classifiedRef = useRef<Set<string>>(new Set());
  const pinnedTargetRef = useRef<{ x: number; y: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setPinnedTarget = useCallback((pt: { x: number; y: number }) => {
    pinnedTargetRef.current = pt;
    setState((s) => ({ ...s, pinnedTarget: pt }));
  }, []);

  const clearPinnedTarget = useCallback(() => {
    pinnedTargetRef.current = null;
    setState((s) => ({ ...s, pinnedTarget: null }));
  }, []);

  const scan = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    setState((s) => ({ ...s, scanning: true }));
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices
        .filter((d) => d.kind === "videoinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${idx + 1}`,
        }));
      setState((s) => ({ ...s, devices: cameras, scanning: false }));
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
    pausedRef.current = false;
    abortControllerRef.current?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => ({ ...s, connected: false, paused: false, outcome: null, fps: 0 }));
  }, []);

  const pauseFeed = useCallback(() => {
    runningRef.current = false;
    pausedRef.current = true;
    abortControllerRef.current?.abort();
    setState((s) => ({ ...s, paused: true }));
  }, []);

  const resumeFeed = useCallback(() => {
    pausedRef.current = false;
    runningRef.current = true;
    setState((s) => ({ ...s, paused: false, connected: true }));
    void captureLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      resumeFeed();
    } else {
      pauseFeed();
    }
  }, [pauseFeed, resumeFeed]);

  const connect = useCallback(
    async (deviceId: string) => {
      setState((s) => ({ ...s, error: null }));
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId === "" ? true : { deviceId: { exact: deviceId } },
          audio: false,
        });
        streamRef.current = stream;
        const media = mediaRef.current;
        if (media && "srcObject" in media) {
          (media as HTMLVideoElement).srcObject = stream;
          await (media as HTMLVideoElement).play();
        }
        setState((s) => ({ ...s, connected: true, paused: false }));
        void scan();
        runningRef.current = true;
        pausedRef.current = false;
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
    // captureLoop is stable via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, mediaRef],
  );

  const startExternalStream = useCallback(() => {
    if (runningRef.current && !pausedRef.current) return;
    runningRef.current = true;
    pausedRef.current = false;
    setState((s) => ({ ...s, connected: true, paused: false, error: null }));
    void captureLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMediaDimensions = (media: HTMLVideoElement | HTMLImageElement | null) => {
    if (!media) return { w: 0, h: 0 };
    if ("videoWidth" in media && (media as HTMLVideoElement).videoWidth > 0) {
      return { w: (media as HTMLVideoElement).videoWidth, h: (media as HTMLVideoElement).videoHeight };
    }
    if ("naturalWidth" in media && (media as HTMLImageElement).naturalWidth > 0) {
      return { w: (media as HTMLImageElement).naturalWidth, h: (media as HTMLImageElement).naturalHeight };
    }
    if ("width" in media && media.width > 0) {
      return { w: media.width, h: media.height };
    }
    return { w: 0, h: 0 };
  };

  /**
   * Paced Frame Sampling Loop.
   * Throttled to ~10 FPS (100ms interval) to prevent net::ERR_INSUFFICIENT_RESOURCES
   */
  const captureLoop = useCallback(async () => {
    if (canvasRef.current === null) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = GRID_WIDTH;
      canvasRef.current.height = GRID_HEIGHT;
    }
    const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true });
    
    while (runningRef.current && !pausedRef.current) {
      const sentAt = performance.now();
      const media = mediaRef.current;
      const { w } = getMediaDimensions(media);

      if (ctx === null || media === null || w === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      try {
        ctx.drawImage(media, 0, 0, GRID_WIDTH, GRID_HEIGHT);
        const { data } = ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
        const samples = new Array<number>(GRID_WIDTH * GRID_HEIGHT);
        for (let i = 0; i < samples.length; i += 1) {
          const o = i * 4;
          samples[i] =
            (0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0)) | 0;
        }

        const dtSecs = lastFrameAtRef.current === 0 ? 0.1 : (sentAt - lastFrameAtRef.current) / 1000;
        lastFrameAtRef.current = sentAt;

        const pt = pinnedTargetRef.current;
        abortControllerRef.current = new AbortController();

        const res = await fetch("/engine/api/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            camera_id: "webcam",
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            samples,
            dt_secs: dtSecs,
            pinned_target: pt ? [pt.x, pt.y] : null,
          }),
        });

        if (!res.ok) throw new Error(`engine ${res.status}`);
        const outcome = (await res.json()) as FrameOutcome;
        const now = performance.now();
        framesRef.current = [...framesRef.current, now].filter((t) => now - t < 1000);
        setState((s) => ({
          ...s,
          outcome,
          fps: framesRef.current.length,
          latencyMs: Math.round(now - sentAt),
          error: null,
        }));

        for (const objectId of outcome.triggered) {
          if (classifiedRef.current.has(objectId)) continue;
          classifiedRef.current.add(objectId);
          void classifyObject(objectId, outcome);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          break; // Silent exit on deliberate abort/pause
        }
        setState((s) => ({
          ...s,
          error:
            err instanceof Error
              ? `Vision engine error: ${err.message}`
              : "engine error",
        }));
        await new Promise((r) => setTimeout(r, 500));
      }

      // Enforce minimum 100ms delay between frames (~10 FPS max) to save browser resources
      const elapsed = performance.now() - sentAt;
      const targetDelay = 100;
      if (elapsed < targetDelay) {
        await new Promise((r) => setTimeout(r, targetDelay - elapsed));
      }
    }
  }, [mediaRef]);

  /** Capture a full-colour JPEG of the current frame for the vision model. */
  const grabSnapshot = useCallback((): string => {
    const media = mediaRef.current;
    const { w, h } = getMediaDimensions(media);
    if (!media || w === 0) return "";
    if (snapshotRef.current === null) snapshotRef.current = document.createElement("canvas");
    const canvas = snapshotRef.current;
    canvas.width = 640;
    canvas.height = Math.round((640 * h) / w);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return "";
    ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
  }, [mediaRef]);

  const classifyObject = useCallback(
    async (objectId: string, outcome: FrameOutcome) => {
      if (pausedRef.current) return;
      setState((s) => ({ ...s, classifying: true }));
      const image = grabSnapshot();
      try {
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: {
              objectId,
              class: "moving_region",
              confidence: 0.98,
              frames: [outcome.frame - 2, outcome.frame - 1, outcome.frame],
              cameraId: "webcam",
              snapshotRef: `frame-${outcome.frame}`,
            },
            image,
          }),
        });
        const body = (await res.json()) as {
          event: {
            class: string;
            confidence: number;
            evidence: Array<{ label: string; description: string }>;
            model: string;
            promptVersion?: string;
            rejectedReason?: string;
            identity?: IdentityInfo;
            descriptors?: Array<{ key: string; value: string }>;
          };
          latencyMs?: number;
        };
        const entry: Classification = {
          objectId,
          label: body.event.class,
          confidence: body.event.confidence,
          evidence: body.event.evidence,
          model: body.event.model,
          at: new Date().toISOString(),
        };
        if (body.event.promptVersion !== undefined) entry.promptVersion = body.event.promptVersion;
        if (body.event.rejectedReason !== undefined)
          entry.rejectedReason = body.event.rejectedReason;
        if (body.latencyMs !== undefined) entry.latencyMs = body.latencyMs;
        if (body.event.identity !== undefined) entry.identity = body.event.identity;
        if (body.event.descriptors !== undefined) entry.descriptors = body.event.descriptors;
        setState((s) => ({
          ...s,
          classifying: false,
          classifications: [entry, ...s.classifications].slice(0, 20),
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          classifying: false,
          classifications: [
            {
              objectId,
              label: "unknown",
              confidence: 0,
              evidence: [],
              model: "unclassified",
              rejectedReason:
                err instanceof Error ? `gateway unreachable: ${err.message}` : "gateway error",
              at: new Date().toISOString(),
            },
            ...s.classifications,
          ].slice(0, 20),
        }));
      }
    },
    [grabSnapshot],
  );

  // Gentle YOLO object detection loop (~1.5s cadence)
  useEffect(() => {
    if (!state.connected || state.paused) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pass = async () => {
      if (pausedRef.current) return;
      const image = grabSnapshot();
      if (image === "") {
        timer = setTimeout(() => void pass(), 500);
        return;
      }
      const started = performance.now();
      try {
        const res = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image }),
        });
        const body = (await res.json()) as {
          objects?: DetectedObject[];
          error?: string;
        };
        if (cancelled || pausedRef.current) return;
        if (!res.ok) {
          setState((s) => ({ ...s, detectError: body.error ?? `detector ${res.status}` }));
        } else {
          setState((s) => ({
            ...s,
            detections: body.objects ?? [],
            detectLatencyMs: Math.round(performance.now() - started),
            detectError: null,
          }));
        }
      } catch (err) {
        if (!cancelled && !pausedRef.current) {
          setState((s) => ({
            ...s,
            detectError: err instanceof Error ? err.message : "detector unreachable",
          }));
        }
      }
      if (!cancelled && !pausedRef.current) timer = setTimeout(() => void pass(), 1500);
    };
    void pass();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state.connected, state.paused, grabSnapshot]);

  // Clean up all loops and connections immediately on page navigation
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    scan,
    connect,
    startExternalStream,
    disconnect,
    pauseFeed,
    resumeFeed,
    togglePause,
    setPinnedTarget,
    clearPinnedTarget,
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
  };
}
