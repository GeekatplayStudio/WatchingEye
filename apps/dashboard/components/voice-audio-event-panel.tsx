"use client";

/**
 * Upload a clip → `/api/voice/audio-event` → closed AudioEvent or reject.
 * Stub detector only until a live classifier lands (ROADMAP V.1).
 */

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AudioEventResult {
  outcome?: "event" | "rejected";
  event?: { kind: string; confidence: number; provenance?: { model_version: string } } | null;
  rejectedReason?: string;
  detector?: { model: string };
  error?: string;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function VoiceAudioEventPanel() {
  const [result, setResult] = useState<AudioEventResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submitStubBark() {
    startTransition(async () => {
      const res = await fetch("/api/voice/audio-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: btoa("KIND:bark\nstub-fixture"),
          mimeType: "application/octet-stream",
        }),
      });
      setResult((await res.json()) as AudioEventResult);
    });
  }

  function submitFile(file: File | undefined) {
    if (file === undefined) return;
    startTransition(async () => {
      const audioBase64 = await fileToBase64(file);
      const res = await fetch("/api/voice/audio-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: file.type || "audio/wav" }),
      });
      setResult((await res.json()) as AudioEventResult);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Audio events
          <Badge variant="outline">stub</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Closed kinds: <code>glass_break</code>, <code>bark</code>,{" "}
          <code>other</code>. Unknown clips reject — no false positives. Live
          YAMNet-class classifier still open.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={submitStubBark}>
            Stub bark fixture
          </Button>
          <input
            type="file"
            accept="audio/*,.wav,.webm"
            disabled={pending}
            className="text-xs"
            onChange={(e) => submitFile(e.target.files?.[0])}
          />
        </div>
        {result !== null && (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
