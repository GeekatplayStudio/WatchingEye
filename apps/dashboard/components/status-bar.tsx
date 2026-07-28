"use client";

/** Compact icon bar: service health and camera controls at a glance. */
import { Camera, Cpu, Brain, Server, RefreshCw, Unplug, Plug } from "lucide-react";
import type { Health } from "@/lib/use-service-status";
import { cn } from "@/lib/utils";

const DOT: Record<Health, string> = {
  up: "bg-primary",
  down: "bg-danger",
  unknown: "bg-muted-foreground",
};

const LABEL: Record<Health, string> = {
  up: "running",
  down: "not reachable",
  unknown: "checking…",
};

/** One service indicator: icon, name, and a health dot. */
export function StatusChip({
  icon: Icon,
  name,
  health,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  health: Health;
  detail?: string | undefined;
}) {
  return (
    <span
      title={`${name}: ${LABEL[health]}${detail !== undefined ? ` (${detail})` : ""}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{name}</span>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[health])} />
    </span>
  );
}

/** Small icon-only action button. */
export function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs transition-colors disabled:opacity-40",
        tone === "primary" && "border-primary/40 text-primary hover:bg-primary/10",
        tone === "danger" && "border-danger/40 text-danger hover:bg-danger/10",
        tone === "default" && "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export { Camera, Cpu, Brain, Server, RefreshCw, Unplug, Plug };
