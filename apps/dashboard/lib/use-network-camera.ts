"use client";

/**
 * Client for a server-side RTSP camera: connect, poll, disconnect.
 *
 * There is no browser video element for a network camera — the engine
 * decodes it directly over RTSP. What this polls is the exact grayscale
 * grid and [`FrameOutcome`] the deterministic pipeline is working from, so
 * the preview shows what the engine actually sees, not a nicer-looking
 * stand-in for it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GRID_HEIGHT, GRID_WIDTH, type FrameOutcome } from "./use-webcam-pipeline";

const POLL_MS = 700;

/** Response shape of `GET /api/cameras/rtsp/:id/latest`. */
interface LatestResponse {
  connected: boolean;
  outcome: FrameOutcome | null;
  width: number;
  height: number;
  samples_b64: string | null;
}

/** Decode base64 into bytes, without assuming a particular text encoding. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function useNetworkCamera(cameraId: string) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [outcome, setOutcome] = useState<FrameOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const paint = useCallback((width: number, height: number, samples: Uint8Array) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < samples.length; i += 1) {
      const v = samples[i] ?? 0;
      const o = i * 4;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/engine/api/cameras/rtsp/${cameraId}/latest`);
      if (res.status === 404) {
        setConnected(false);
        stopPolling();
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as LatestResponse;
      setConnected(body.connected);
      setOutcome(body.outcome);
      if (body.samples_b64 !== null) {
        paint(body.width, body.height, decodeBase64(body.samples_b64));
      }
      if (!body.connected) stopPolling();
    } catch {
      // A single missed poll is not an error worth surfacing; the next
      // tick tries again. Only a connect/disconnect failure is reported.
    }
  }, [cameraId, paint, stopPolling]);

  const connect = useCallback(
    async (url: string) => {
      setConnecting(true);
      setError(null);
      try {
        const res = await fetch("/engine/api/cameras/rtsp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ camera_id: cameraId, url }),
        });
        if (!res.ok) {
          const text = await res.text();
          let message = `engine ${res.status}`;
          try {
            const parsed = JSON.parse(text) as { error?: string };
            if (typeof parsed.error === "string") message = parsed.error;
          } catch {
            /* not JSON */
          }
          throw new Error(message);
        }
        setConnected(true);
        stopPolling();
        pollRef.current = setInterval(() => void poll(), POLL_MS);
        void poll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "could not connect");
      } finally {
        setConnecting(false);
      }
    },
    [cameraId, poll, stopPolling],
  );

  const disconnect = useCallback(async () => {
    stopPolling();
    setConnected(false);
    setOutcome(null);
    try {
      await fetch("/engine/api/cameras/rtsp/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cameraId }),
      });
    } catch {
      // The engine will time the task out on its own if this never
      // arrives; nothing further to do client-side.
    }
  }, [cameraId, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  return {
    canvasRef,
    connect,
    disconnect,
    connecting,
    connected,
    outcome,
    error,
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
  };
}
