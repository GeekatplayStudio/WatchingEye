"use client";

/**
 * Tuning: edit the deterministic gates live. Values map 1:1 to the Rust
 * `TriggerGate` and `guardrails::Policy` structs; the gateway validates
 * ranges and broadcasts changes to all connected clients.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import type { Settings } from "@/lib/types";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export default function TuningPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json() as Promise<Settings>)
      .then(setSettings)
      .catch(() => setStatus("error"));
  }, []);

  async function save() {
    if (!settings) return;
    setStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tuning</h1>
        <div className="flex items-center gap-3">
          {status === "saved" && <Badge variant="success">saved</Badge>}
          {status === "error" && <Badge variant="danger">error</Badge>}
          <Button onClick={() => void save()} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Apply"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Slider
            label="Minimum detection confidence"
            value={settings.minDetectionConfidence}
            min={0} max={1} step={0.01} format={pct}
            onChange={(v) => set({ minDetectionConfidence: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Super Agent Trigger Gate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Slider
            label="Gate minimum confidence"
            value={settings.gateMinConfidence}
            min={0.5} max={1} step={0.01} format={pct}
            onChange={(v) => set({ gateMinConfidence: v })}
          />
          <Slider
            label="Required consecutive frames"
            value={settings.gateConsecutiveFrames}
            min={1} max={10} step={1}
            onChange={(v) => set({ gateConsecutiveFrames: v })}
          />
          <p className="text-xs text-muted-foreground">
            The agent runs only when both gates pass — it never runs continuously.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guardrail Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Slider
            label="Minimum decision confidence"
            value={settings.policyMinConfidence}
            min={0.5} max={1} step={0.01} format={pct}
            onChange={(v) => set({ policyMinConfidence: v })}
          />
          <div>
            <span className="text-sm text-muted-foreground">Allowed actions</span>
            <div className="mt-1 flex gap-1.5">
              {settings.allowedActions.map((a) => (
                <Badge key={a} variant="outline">{a}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
