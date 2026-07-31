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

/**
 * Sample grid sent to the engine. Small on purpose — the engine works on
 * luminance, and this keeps the round trip well under a frame budget.
 *
 * Exported because `use-network-camera` needs the same numbers to size the
 * canvas it renders the engine's polled grid samples into — the RTSP
 * capture path decodes server-side at this exact resolution
 * (`services/vision-engine/src/rtsp.rs`), so the two must agree.
 */
export const GRID_WIDTH = 96;
export const GRID_HEIGHT = 72;

/** A region the engine is tracking. */
export interface TrackedRegion {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  seen_frames: number;
  missed_frames: number;
  gate_open: boolean;
  /** Samples per frame, used to extrapolate between engine updates. */
  vx: number;
  vy: number;
  /** Direction and speed of travel. */
  motion: {
    heading: string;
    speed: number;
    angle_deg: number;
  };
}

/** Arrow glyph for a heading reported by the engine. */
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

/** Where the head is aiming, in normalised coordinates. */
export interface AimTarget {
  x: number;
  y: number;
  area: number;
}

/** Pan/tilt command the engine produced for this frame. */
export interface ServoCommand {
  pan_deg: number;
  tilt_deg: number;
  tracking: boolean;
  reason: string;
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
  target: AimTarget | null;
  servo: ServoCommand;
  target_id: string | null;
  pinned_target: [number, number] | null;
  /** Whether a Point Cross assignment is following, holding, or inactive. */
  pinned_status: PinnedStatus;
  /** The track the assignment is following, when it has one. */
  pinned_track_id: string | null;
}

/**
 * State of a Point Cross assignment. `following` means the engine has locked
 * onto the subject that was clicked and is tracking it as it moves;
 * `searching` means the assignment stands but nothing is there to follow.
 */
export type PinnedStatus = "idle" | "following" | "searching";

/** A camera the browser can see. */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/** Who the registry says this is. */
export interface IdentityInfo {
  id: string;
  name: string | null;
  isNew: boolean;
  sightings: number;
  score?: number;
  matched?: string[];
}

/** A classification the guardrails accepted (or explicitly refused). */
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
  /** Identifying attributes the model reported. */
  descriptors?: Array<{ key: string; value: string }>;
  at: string;
}

/** One labelled object from the full-frame detector. */
export interface DetectedObject {
  class: string;
  cocoLabel: string;
  confidence: number;
  /** Normalised (0..1) box on the original image. */
  bbox: { x: number; y: number; width: number; height: number };
  distance: {
    metres: number;
    minMetres: number;
    maxMetres: number;
    basis: string;
  } | null;
  /** True when this class is unchecked in the class filter. */
  filtered?: boolean;
}

interface PipelineState {
  devices: CameraDevice[];
  scanning: boolean;
  connected: boolean;
  error: string | null;
  outcome: FrameOutcome | null;
  fps: number;
  /** Round-trip time to the engine, in milliseconds. */
  latencyMs: number;
  classifications: Classification[];
  classifying: boolean;
  /** Latest full-frame detections (stationary objects included). */
  detections: DetectedObject[];
  /** Round-trip of the last detection pass, ms. */
  detectLatencyMs: number;
  /** Set when the detector cannot run (e.g. model missing). */
  detectError: string | null;
  /** Active Point Cross Assign target position (normalized 0..1). */
  pinnedTarget: { x: number; y: number } | null;
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
    latencyMs: 0,
    classifications: [],
    classifying: false,
    detections: [],
    detectLatencyMs: 0,
    detectError: null,
    pinnedTarget: null,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(false);
  const framesRef = useRef<number[]>([]);
  const lastFrameAtRef = useRef(0);
  const classifiedRef = useRef<Set<string>>(new Set());
  const pinnedTargetRef = useRef<{ x: number; y: number } | null>(null);

  const setPinnedTarget = useCallback((pt: { x: number; y: number } | null) => {
    pinnedTargetRef.current = pt;
    setState((s) => ({ ...s, pinnedTarget: pt }));
  }, []);

  const clearPinnedTarget = useCallback(() => {
    pinnedTargetRef.current = null;
    setState((s) => ({ ...s, pinnedTarget: null }));
  }, []);

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
      const sentAt = performance.now();
      const dtSecs = lastFrameAtRef.current === 0 ? 0.1 : (sentAt - lastFrameAtRef.current) / 1000;
      lastFrameAtRef.current = sentAt;
      try {
        const pt = pinnedTargetRef.current;
        const res = await fetch("/engine/api/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

        // The gate opened: this is the only moment a model is consulted.
        for (const objectId of outcome.triggered) {
          if (classifiedRef.current.has(objectId)) continue;
          classifiedRef.current.add(objectId);
          void classifyObject(objectId, outcome);
        }
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
      // Yield to the next paint rather than sleeping a fixed interval: the
      // capture rate then follows whatever the machine can actually sustain
      // instead of being pinned to an arbitrary ceiling.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }, [videoRef]);

  /** Capture a full-colour JPEG of the current frame for the vision model. */
  const grabSnapshot = useCallback((): string => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return "";
    if (snapshotRef.current === null) snapshotRef.current = document.createElement("canvas");
    const canvas = snapshotRef.current;
    canvas.width = 640;
    canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return "";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
  }, [videoRef]);

  /**
   * Send one gated object for classification. Failures surface as an
   * explicit "unclassified" entry rather than being dropped.
   */
  const classifyObject = useCallback(
    async (objectId: string, outcome: FrameOutcome) => {
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

  /**
   * Full-frame detection loop, independent of the motion pipeline. This is
   * what names things that are not moving — a parked car never trips motion
   * detection, but YOLO still sees it. Runs at a gentle cadence because a
   * full pass costs ~0.5s of CPU.
   */
  useEffect(() => {
    if (!state.connected) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pass = async () => {
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
        if (cancelled) return;
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
        if (!cancelled) {
          setState((s) => ({
            ...s,
            detectError: err instanceof Error ? err.message : "detector unreachable",
          }));
        }
      }
      if (!cancelled) timer = setTimeout(() => void pass(), 1200);
    };
    void pass();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state.connected, grabSnapshot]);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    ...state,
    scan,
    connect,
    disconnect,
    setPinnedTarget,
    clearPinnedTarget,
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
  };
}
