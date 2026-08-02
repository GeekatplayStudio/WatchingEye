"use client";

/**
 * Wake gate: oneshot arm or V.4 continuous armed listen → `/api/voice/wake`.
 * Browser opt-in only — not production always-on.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  initialContinuousListen,
  onWake,
  onWakeRejected,
  onWindowTick,
  shouldPostWakeChunks,
  startContinuous,
  stopContinuous,
  type ContinuousListenState,
} from "@/lib/continuous-listen";
import { blobToBase64, recordWakeChunk, WAKE_CHUNK_MS } from "@/lib/wake-mic-chunk";

interface WakeResult {
  outcome?: "wake" | "rejected";
  detection?: { keyword: string; confidence: number; provenance?: { model_version: string } } | null;
  rejectedReason?: string;
  detector?: { model: string };
  error?: string;
}

const WINDOW_MS = 20_000;

export function VoiceWakePanel() {
  const [listen, setListen] = useState<ContinuousListenState>(initialContinuousListen);
  const [oneshotArmed, setOneshotArmed] = useState(false);
  const [result, setResult] = useState<WakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const listenRef = useRef(listen);
  const oneshotRef = useRef(oneshotArmed);
  listenRef.current = listen;
  oneshotRef.current = oneshotArmed;

  const windowOpen =
    listen.phase === "ptt_window" &&
    listen.windowUntil !== null &&
    now < listen.windowUntil;
  const micActive = oneshotArmed || listen.continuous;

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setListen((s) => onWindowTick(s, t));
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      clearMicLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  useEffect(() => {
    if (!listen.continuous || listen.phase !== "listening") return;
    if (streamRef.current === null || timerRef.current !== null) return;
    startChunkTimer(streamRef.current);
  }, [listen.continuous, listen.phase]);

  function clearMicLoop() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOneshotArmed(false);
  }

  function pauseChunkTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startChunkTimer(stream: MediaStream) {
    pauseChunkTimer();
    const tick = () => {
      if (streamRef.current === null) return;
      const allow =
        oneshotRef.current || shouldPostWakeChunks(listenRef.current, Date.now());
      if (!allow) return;
      void postChunk(streamRef.current);
    };
    tick();
    timerRef.current = setInterval(tick, WAKE_CHUNK_MS + 200);
  }

  function applyWakeHit(wasContinuous: boolean) {
    const t = Date.now();
    setListen((s) => onWake(s, t, WINDOW_MS));
    setNow(t);
    pauseChunkTimer();
    if (!wasContinuous) clearMicLoop();
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
      if (body.outcome === "wake") applyWakeHit(listenRef.current.continuous);
    });
  }

  async function postChunk(stream: MediaStream) {
    if (busyRef.current) return;
    const allow =
      oneshotRef.current || shouldPostWakeChunks(listenRef.current, Date.now());
    if (!allow) return;
    busyRef.current = true;
    try {
      const blob = await recordWakeChunk(stream);
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/voice/wake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || "audio/webm" }),
      });
      const body = (await res.json()) as WakeResult;
      setResult(body);
      if (!res.ok || body.error !== undefined) {
        setStatus(body.error ?? `wake HTTP ${res.status}`);
        setListen((s) => onWakeRejected(s));
        return;
      }
      setStatus(null);
      if (body.outcome === "wake") applyWakeHit(listenRef.current.continuous);
      else setListen((s) => onWakeRejected(s));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "wake request failed");
      setListen((s) => onWakeRejected(s));
    } finally {
      busyRef.current = false;
    }
  }

  async function beginMic(continuous: boolean) {
    setError(null);
    setResult(null);
    setStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (continuous) {
        setListen(startContinuous(initialContinuousListen()));
        setOneshotArmed(false);
      } else {
        setListen(initialContinuousListen());
        setOneshotArmed(true);
      }
      startChunkTimer(stream);
    } catch (err) {
      setError(err instanceof Error ? err.message : "microphone unavailable");
      setListen(stopContinuous(initialContinuousListen()));
      setOneshotArmed(false);
    }
  }

  function stopAll() {
    clearMicLoop();
    setListen(stopContinuous(initialContinuousListen()));
    setStatus(null);
  }

  const detector = result?.detector?.model ?? result?.detection?.provenance?.model_version;
  const secsLeft =
    listen.windowUntil !== null
      ? Math.max(0, Math.ceil((listen.windowUntil - now) / 1000))
      : 0;
  const phaseLabel = listen.continuous
    ? listen.phase === "ptt_window"
      ? "continuous · ptt"
      : "continuous"
    : (detector ?? "stub");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Wake gate
          <Badge variant="outline">{phaseLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Chunks → <code>/api/voice/wake</code>. Continuous mode keeps the browser
          mic armed and resumes after each PTT window — not production always-on.
          Stub <code>watchingeye</code>; live classifier <code>hey_jarvis</code>{" "}
          when weights are present.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending || micActive} onClick={submitStubWake}>
            Stub wake fixture
          </Button>
          <Button
            type="button"
            variant={oneshotArmed ? "accent" : "outline"}
            disabled={pending || listen.continuous}
            onClick={() => {
              if (oneshotArmed) stopAll();
              else void beginMic(false);
            }}
          >
            {oneshotArmed ? "Disarm" : "Arm once"}
          </Button>
          <Button
            type="button"
            variant={listen.continuous ? "accent" : "outline"}
            disabled={pending || oneshotArmed}
            onClick={() => {
              if (listen.continuous) stopAll();
              else void beginMic(true);
            }}
          >
            {listen.continuous ? "Stop continuous" : "Continuous listen"}
          </Button>
        </div>
        {windowOpen && (
          <p className="rounded-md border border-border px-3 py-2 text-xs">
            Wake detected — use Live mic push-to-talk below ({secsLeft}s)
            {listen.continuous ? "; listening resumes after." : "."}
          </p>
        )}
        {status !== null && (
          <p className="text-xs text-muted-foreground">Wake status: {status}</p>
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
