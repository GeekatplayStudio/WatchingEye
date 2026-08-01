"use client";

/**
 * SpokenFact[] → gateway `/api/voice/speak` → templated speech + WAV.
 * Free-form text is never sent.
 */

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DEMO_FACTS = [
  {
    objectClass: "person",
    cameraId: "driveway",
    timestamp: "2026-07-27T15:14:00Z",
    confidence: 0.98,
  },
];

interface SpeakResult {
  outcome?: "spoken" | "rejected";
  speechText?: string;
  audioBase64?: string;
  mimeType?: string;
  tts?: { model: string };
  rejectedReason?: string;
  error?: string;
}

export function VoiceSpeakPanel() {
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  function speak(facts: typeof DEMO_FACTS | []) {
    startTransition(async () => {
      if (audioUrl !== null) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });
      const body = (await res.json()) as SpeakResult;
      setResult(body);
      if (body.audioBase64 !== undefined && body.audioBase64.length > 0) {
        const binary = atob(body.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: body.mimeType ?? "audio/wav" });
        setAudioUrl(URL.createObjectURL(blob));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Speak validated facts
          <Badge variant="outline">facts → TTS</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Only structured detection facts are accepted. The orchestrator templates
          speech with <code>renderSpeech</code>, then runs stub/Piper TTS.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => speak(DEMO_FACTS)}>
            Speak demo fact
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => speak([])}
          >
            Speak empty feed
          </Button>
        </div>
        {result?.speechText !== undefined && (
          <p className="rounded-md border border-border px-3 py-2 font-mono text-xs">
            {result.speechText}
          </p>
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
                tts: result.tts,
                rejectedReason: result.rejectedReason,
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
