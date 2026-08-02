"use client";

/**
 * Push-to-talk duplex: MediaRecorder → command or ask → play spoken WAV.
 * Continuous always-on listen remains out of scope; use Wake gate to arm chunks.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MicMode = "ask" | "command";

interface MicResult {
  outcome?: string;
  transcript?: string;
  rejectedReason?: string;
  command?: { intent?: string };
  recall?: { citations?: string[]; answer?: string };
  speak?: {
    speechText?: string;
    audioBase64?: string;
    mimeType?: string;
    tts?: { model: string };
  };
  stt?: { model: string };
  error?: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function playBase64Wav(b64: string, mimeType: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function VoiceLiveMicPanel() {
  const [mode, setMode] = useState<MicMode>("ask");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MicResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioUrl !== null) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function startRec() {
    setError(null);
    setResult(null);
    if (audioUrl !== null) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        startTransition(async () => {
          const audioBase64 = await blobToBase64(blob);
          const url = mode === "ask" ? "/api/voice/ask" : "/api/voice/command";
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64, mimeType: blob.type || "audio/webm" }),
          });
          const body = (await res.json()) as MicResult;
          setResult(body);
          const b64 = body.speak?.audioBase64;
          if (b64 !== undefined && b64.length > 0) {
            setAudioUrl(playBase64Wav(b64, body.speak?.mimeType ?? "audio/wav"));
          }
        });
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "microphone unavailable");
    }
  }

  function stopRec() {
    const rec = mediaRef.current;
    if (rec !== null && rec.state !== "inactive") rec.stop();
    mediaRef.current = null;
    setRecording(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Live mic (push-to-talk)
          <Badge variant="outline">duplex</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Hold to record, release to send. Ask mode runs recall→speak; command
          mode returns a closed intent. Pair with Wake gate for armed chunks —
          not continuous always-on listen.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "ask" ? "default" : "outline"}
            disabled={recording || pending}
            onClick={() => setMode("ask")}
          >
            Ask
          </Button>
          <Button
            type="button"
            variant={mode === "command" ? "default" : "outline"}
            disabled={recording || pending}
            onClick={() => setMode("command")}
          >
            Command
          </Button>
        </div>
        <Button
          type="button"
          variant={recording ? "accent" : "default"}
          disabled={pending}
          onMouseDown={() => void startRec()}
          onMouseUp={stopRec}
          onMouseLeave={() => {
            if (recording) stopRec();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            void startRec();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopRec();
          }}
        >
          {recording ? "Release to send" : pending ? "Working…" : "Hold to talk"}
        </Button>
        {error !== null && (
          <p className="text-xs text-muted-foreground">Mic error: {error}</p>
        )}
        {result?.transcript !== undefined && result.transcript !== "" && (
          <p className="font-mono text-xs text-muted-foreground">Heard: {result.transcript}</p>
        )}
        {result?.speak?.speechText !== undefined && (
          <p className="rounded-md border border-border px-3 py-2 font-mono text-xs">
            {result.speak.speechText}
          </p>
        )}
        {audioUrl !== null && (
          <audio controls autoPlay src={audioUrl} className="w-full">
            <track kind="captions" />
          </audio>
        )}
        {result !== null && (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(
              {
                outcome: result.outcome,
                intent: result.command?.intent,
                rejectedReason: result.rejectedReason,
                citations: result.recall?.citations,
                tts: result.speak?.tts,
                stt: result.stt,
                error: result.error,
              },
              null,
              2,
            )}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
