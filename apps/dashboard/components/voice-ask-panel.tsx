"use client";

/**
 * Text-path ask: transcript → `/api/voice/ask` → citations + spoken WAV.
 * Live mic duplex remains ROADMAP-open.
 */

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AskResult {
  outcome?: "answered" | "rejected";
  transcript?: string;
  rejectedReason?: string;
  recall?: { citations: string[]; answer: string; count: number };
  speak?: {
    speechText?: string;
    audioBase64?: string;
    mimeType?: string;
    tts?: { model: string };
  };
}

export function VoiceAskPanel() {
  const [text, setText] = useState("what happened today");
  const [result, setResult] = useState<AskResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  function ask() {
    startTransition(async () => {
      if (audioUrl !== null) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      const res = await fetch("/api/voice/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const body = (await res.json()) as AskResult;
      setResult(body);
      const b64 = body.speak?.audioBase64;
      if (b64 !== undefined && b64.length > 0) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        setAudioUrl(
          URL.createObjectURL(new Blob([bytes], { type: body.speak?.mimeType ?? "audio/wav" })),
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Ask the timeline
          <Badge variant="outline">ask → recall → speak</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          History questions only (<code>query_events</code>). Answer speech is
          templated from dataset facts — not the recall prose string.
        </p>
        <label className="block space-y-1">
          <span className="text-muted-foreground">Transcript</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="what happened today"
          />
        </label>
        <Button type="button" disabled={pending} onClick={ask}>
          Ask
        </Button>
        {result?.speak?.speechText !== undefined && (
          <p className="rounded-md border border-border px-3 py-2 font-mono text-xs">
            {result.speak.speechText}
          </p>
        )}
        {result?.recall?.answer !== undefined && (
          <p className="text-xs text-muted-foreground">{result.recall.answer}</p>
        )}
        {audioUrl !== null && (
          <audio controls src={audioUrl} className="w-full">
            <track kind="captions" />
          </audio>
        )}
        {result !== null && (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(
              {
                outcome: result.outcome,
                rejectedReason: result.rejectedReason,
                citations: result.recall?.citations,
                tts: result.speak?.tts,
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
