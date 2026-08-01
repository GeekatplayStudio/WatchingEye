"use client";

/**
 * Upload or type a phrase → gateway `/api/voice/command` → closed VoiceCommand.
 * Transcript is untrusted; rejected phrases never become actions.
 */

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VoiceResult {
  outcome?: "command" | "rejected";
  transcript?: string;
  command?: { intent: string; [k: string]: unknown } | null;
  rejectedReason?: string;
  stt?: { model: string };
  latencyMs?: number;
  error?: string;
}

export function VoiceCommandPanel() {
  const [text, setText] = useState("show me the driveway");
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submitTranscript() {
    startTransition(async () => {
      const res = await fetch("/api/voice/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      setResult((await res.json()) as VoiceResult);
    });
  }

  function submitFile(file: File | undefined) {
    if (file === undefined) return;
    startTransition(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const res = await fetch("/api/voice/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: btoa(binary),
          mimeType: file.type || "audio/wav",
        }),
      });
      setResult((await res.json()) as VoiceResult);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Try a command
          <Badge variant="outline">STT → parse</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="block space-y-1">
          <span className="text-muted-foreground">Transcript (skip Whisper)</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="show me the driveway"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={submitTranscript}>
            Parse transcript
          </Button>
          <label className="inline-flex cursor-pointer items-center">
            <span className="sr-only">Upload audio</span>
            <input
              type="file"
              accept="audio/*,.wav,.webm"
              className="text-xs"
              disabled={pending}
              onChange={(e) => submitFile(e.target.files?.[0])}
            />
          </label>
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
