"use client";

/**
 * Natural Language Dynamic Tracking & Dataset Recall Control Panel.
 *
 * Allows users to register dynamic tracking directives in plain text
 * (e.g. "track and register all dogs", "track all cars and capture license plates")
 * and perform dataset recall queries over historical event evidence.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, Database, Plus, Check } from "lucide-react";

export function ActiveTrackingPanel({
  activeClasses,
  onAddPrompt,
}: {
  activeClasses: string[];
  onAddPrompt?: (prompt: string) => Promise<void>;
}) {
  const [promptInput, setPromptInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);

  const handleRegister = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (onAddPrompt) {
        await onAddPrompt(text);
      } else {
        await fetch("/api/nlp/target", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
      }
      setPromptInput("");
    } catch {
      // Ignored for UI fallback
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
          <Sparkles className="h-4 w-4 text-cyan-400" />
          Natural Language Target Registration
        </h3>
        <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/40">
          AI Active
        </Badge>
      </div>

      {/* Natural Language Prompt Input Bar */}
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
          className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <Button type="submit" size="sm" className="h-8 text-xs bg-cyan-600 hover:bg-cyan-500 text-white shrink-0" disabled={submitting}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {submitting ? "Adding…" : "Track"}
        </Button>
      </form>

      {/* Suggestion Chips */}
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="text-muted-foreground mr-1">Quick prompts:</span>
        <button
          onClick={() => void handleRegister("track and register all dogs")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground hover:bg-cyan-950/60 hover:text-cyan-300 transition-colors"
        >
          + Dogs & Breeds
        </button>
        <button
          onClick={() => void handleRegister("track all cars and capture license plates")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground hover:bg-cyan-950/60 hover:text-cyan-300 transition-colors"
        >
          + Cars & ANPR Plates
        </button>
        <button
          onClick={() => void handleRegister("track and alert on people")}
          className="rounded bg-muted/80 px-2 py-0.5 text-muted-foreground hover:bg-cyan-950/60 hover:text-cyan-300 transition-colors"
        >
          + People
        </button>
      </div>

      {/* Active Monitored Classes */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground font-medium text-[11px]">Active Monitored Targets:</span>
        {activeClasses.map((cls) => (
          <Badge key={cls} variant="outline" className="capitalize text-[10px] bg-cyan-950/40 text-cyan-300 border-cyan-500/30">
            <Check className="mr-1 h-3 w-3 text-cyan-400" />
            {cls}
          </Badge>
        ))}
      </div>

      {/* Dataset Vector Recall Query */}
      <form onSubmit={(e: React.FormEvent) => void handleSearch(e)} className="flex items-center gap-1.5 border-t border-border pt-2">
        <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Dataset Recall (e.g. 'golden retriever' or 'ABC-1234')"
          className="h-7 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0">
          <Search className="h-3.5 w-3.5" />
        </Button>
      </form>
      {searchResultCount !== null && (
        <p className="text-[11px] text-cyan-400 font-mono">
          Found {searchResultCount} historical event record(s) matching &quot;{searchQuery}&quot;.
        </p>
      )}
    </div>
  );
}
