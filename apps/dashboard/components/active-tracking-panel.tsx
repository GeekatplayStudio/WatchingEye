"use client";

/**
 * Natural-language target registration and dataset recall.
 *
 * Prompts go to `/api/nlp/target`, which updates settings and broadcasts
 * over WebSocket so every console reflects the new tracked classes immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, Database, Plus, Check } from "lucide-react";

interface ActiveIntent {
  rawPrompt: string;
  targetClasses: string[];
  attributes: string[];
  actionPolicy: string;
  datasetEnroll: boolean;
  anprEnabled: boolean;
  appliedAt: string;
}

interface SettingsSnapshot {
  trackedClasses: string[];
  activeIntent: ActiveIntent | null;
}

export function ActiveTrackingPanel({
  activeClasses: initialClasses,
}: {
  activeClasses: string[];
  onAddPrompt?: (prompt: string) => Promise<void>;
}) {
  const [promptInput, setPromptInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);
  const [activeClasses, setActiveClasses] = useState(initialClasses);
  const [intent, setIntent] = useState<ActiveIntent | null>(null);
  const [lastBroadcastMs, setLastBroadcastMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySettings = useCallback((s: SettingsSnapshot) => {
    setActiveClasses(s.trackedClasses);
    setIntent(s.activeIntent);
  }, []);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json() as Promise<SettingsSnapshot>)
      .then(applySettings)
      .catch(() => undefined);
  }, [applySettings]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = process.env.NEXT_PUBLIC_GATEWAY_WS ?? `${proto}://${window.location.hostname}:8080/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(host);
    } catch {
      return;
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string; settings?: SettingsSnapshot };
        if (msg.type === "settings" && msg.settings !== undefined) {
          applySettings(msg.settings);
        }
      } catch {
        // ignore non-JSON
      }
    };
    return () => ws.close();
  }, [applySettings]);

  const handleRegister = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/nlp/target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const body = (await res.json()) as {
        settings?: SettingsSnapshot;
        broadcastMs?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `request failed (${res.status})`);
        return;
      }
      if (body.settings !== undefined) applySettings(body.settings);
      if (typeof body.broadcastMs === "number") setLastBroadcastMs(body.broadcastMs);
      setPromptInput("");
    } catch {
      setError("gateway unreachable");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(`/api/dataset/search?q=${encodeURIComponent(searchQuery)}`);
      const body = (await res.json()) as { records?: unknown[] };
      setSearchResultCount(body.records?.length ?? 0);
    } catch {
      setSearchResultCount(0);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Natural Language Target Registration
        </h3>
        {lastBroadcastMs !== null && (
          <Badge variant="outline" className="font-mono text-[10px]">
            broadcast {lastBroadcastMs} ms
          </Badge>
        )}
      </div>

      <form
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void handleRegister(promptInput);
        }}
        className="flex gap-1.5"
      >
        <input
          value={promptInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPromptInput(e.target.value)}
          placeholder="e.g. 'track and register all dogs' or 'track cars & plates'"
          className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0 text-xs" disabled={submitting}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {submitting ? "Adding…" : "Track"}
        </Button>
      </form>

      {error !== null && <p className="font-mono text-[11px] text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="mr-1 text-muted-foreground">Quick prompts:</span>
        <button
          type="button"
          onClick={() => void handleRegister("track and register all dogs")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          + Dogs & Breeds
        </button>
        <button
          type="button"
          onClick={() => void handleRegister("track all cars and capture license plates")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          + Cars & ANPR Plates
        </button>
        <button
          type="button"
          onClick={() => void handleRegister("track and alert on people")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          + People
        </button>
      </div>

      {intent !== null && (
        <p className="border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
          Last intent: <span className="text-foreground">{intent.actionPolicy}</span>
          {intent.datasetEnroll ? " · dataset enroll" : ""}
          {intent.anprEnabled ? " · ANPR" : ""}
          {intent.attributes.length > 0 ? ` · ${intent.attributes.join(", ")}` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2 text-xs">
        <span className="text-[11px] font-medium text-muted-foreground">Active Monitored Targets:</span>
        {activeClasses.map((cls) => (
          <Badge key={cls} variant="outline" className="text-[10px] capitalize">
            <Check className="mr-1 h-3 w-3 text-primary" />
            {cls}
          </Badge>
        ))}
      </div>

      <form
        onSubmit={(e: React.FormEvent) => void handleSearch(e)}
        className="flex items-center gap-1.5 border-t border-border pt-2"
      >
        <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Dataset Recall (e.g. 'golden retriever' or 'ABC-1234')"
          className="h-7 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="submit" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs">
          <Search className="h-3.5 w-3.5" />
        </Button>
      </form>
      {searchResultCount !== null && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Found {searchResultCount} historical event record(s) matching &quot;{searchQuery}&quot;.
        </p>
      )}
    </div>
  );
}
