"use client";

/**
 * Armed / chunked wake gate → `/api/voice/wake` → unlock a short PTT window.
 * Not production always-on listening (ROADMAP V.3).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WakeResult {
  outcome?: "wake" | "rejected";
  detection?: { keyword: string; confidence: number; provenance?: { model_version: string } } | null;
  rejectedReason?: string;
  detector?: { model: string };
  error?: string;
}

const WINDOW_MS = 20_000;
const CHUNK_MS = 1_500;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function VoiceWakePanel() {
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<WakeResult | null>(null);
  const [windowUntil, setWindowUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  const windowOpen = windowUntil !== null && now < windowUntil;

  useEffect(() => {
    if (windowUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [windowUntil]);

  useEffect(() => {
    return () => {
      stopArm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  function openWindow() {
    setWindowUntil(Date.now() + WINDOW_MS);
    setNow(Date.now());
  }

  function submitStubWake() {
    startTransition(async () => {
      const res = await fetch("/api/voice/wake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: btoa("WAKE:watchingeye\nstub-fixture"),
          mimeType: "application/octet-stream",
        }),
      });
      const body = (await res.json()) as WakeResult;
      setResult(body);
      if (body.outcome === "wake") openWindow();
    });
  }

  async function postChunk(blob: Blob) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/voice/wake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || "audio/webm" }),
      });
      const body = (await res.json()) as WakeResult;
      setResult(body);
      if (body.outcome === "wake") {
        openWindow();
        stopArm();
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function recordOneChunk(stream: MediaStream): Promise<void> {
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    });
    rec.start();
    await new Promise((r) => setTimeout(r, CHUNK_MS));
    if (rec.state !== "inactive") rec.stop();
    const blob = await done;
    await postChunk(blob);
  }

  async function startArm() {
    setError(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setArmed(true);
      const tick = () => {
        if (streamRef.current === null) return;
        void recordOneChunk(streamRef.current);
      };
      tick();
      timerRef.current = setInterval(tick, CHUNK_MS + 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "microphone unavailable");
      setArmed(false);
    }
  }

  function stopArm() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setArmed(false);
  }

  const detector = result?.detector?.model ?? result?.detection?.provenance?.model_version;
  const secsLeft =
    windowUntil !== null ? Math.max(0, Math.ceil((windowUntil - now) / 1000)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Wake gate
          <Badge variant="outline">{detector ?? "stub"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Armed chunks → <code>/api/voice/wake</code>. Stub keyword{" "}
          <code>watchingeye</code>; live openWakeWord uses allowlisted
          classifier basename (default <code>hey_jarvis</code>). On hit, a short
          PTT window opens — not production always-on.{" "}
          <code>WATCHINGEYE_WAKE=stub|auto|engine</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={submitStubWake}>
            Stub wake fixture
          </Button>
          <Button
            type="button"
            variant={armed ? "accent" : "outline"}
            disabled={pending}
            onClick={() => {
              if (armed) stopArm();
              else void startArm();
            }}
          >
            {armed ? "Disarm mic" : "Arm mic (chunked)"}
          </Button>
        </div>
        {windowOpen && (
          <p className="rounded-md border border-border px-3 py-2 text-xs">
            Wake detected — use Live mic push-to-talk below ({secsLeft}s window).
          </p>
        )}
        {error !== null && (
          <p className="text-xs text-muted-foreground">Mic error: {error}</p>
        )}
        {result !== null && (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
