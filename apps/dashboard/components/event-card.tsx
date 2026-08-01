"use client";

/**
 * One detection event as a hairline-separated row: status column on the
 * left, claim and evidence chain on the right — the console row pattern.
 * Selectable for event-replay detail.
 */
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DetectionEvent } from "@/lib/types";
import { PersonStanding, Dog, Car, Package, HelpCircle, Cat } from "lucide-react";

const CLASS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  person: PersonStanding,
  dog: Dog,
  cat: Cat,
  car: Car,
  truck: Car,
  package: Package,
};

function confidenceVariant(c: number): "success" | "warning" | "danger" {
  if (c >= 0.95) return "success";
  if (c >= 0.8) return "warning";
  return "danger";
}

export function EventCard({
  event,
  selected = false,
  onSelect,
}: {
  event: DetectionEvent;
  selected?: boolean;
  onSelect?: (event: DetectionEvent) => void;
}) {
  const Icon = CLASS_ICONS[event.class] ?? HelpCircle;
  const refused = event.rejectedReason !== undefined;
  const interactive = onSelect !== undefined;

  const body = (
    <>
      <div className="w-28 shrink-0 space-y-1.5">
        {refused ? (
          <StatusBadge variant="danger">refused</StatusBadge>
        ) : event.filtered ? (
          <StatusBadge variant="warning">filtered</StatusBadge>
        ) : (
          <StatusBadge variant={confidenceVariant(event.confidence)}>
            {(event.confidence * 100).toFixed(0)}%
          </StatusBadge>
        )}
        <p className="font-mono text-[0.65rem] text-muted-foreground">
          {new Date(event.timestamp).toLocaleTimeString()}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="font-semibold capitalize">{event.class}</span>
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {event.kind.replaceAll("_", " ")}
            {event.zone ? ` · ${event.zone}` : ""}
          </span>
          {event.identity && (
            <Badge variant="success">{event.identity.name ?? "identity"}</Badge>
          )}
        </div>

        {event.evidence.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.evidence.map((e) => (
              <Badge key={e.label} variant="outline" title={e.description}>
                {e.label.replaceAll("_", " ")}
              </Badge>
            ))}
          </div>
        )}

        <p className="mt-2 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
          <span className="tok">cam:{event.cameraId}</span> frames {event.frames.join(", ")} ·{" "}
          <span className="tok">{event.model}</span>
          {refused && <> · {event.rejectedReason}</>}
        </p>
      </div>
    </>
  );

  if (!interactive) {
    return <article className="flex gap-4 px-4 py-3">{body}</article>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-pressed={selected}
      className={cn(
        "flex w-full gap-4 px-4 py-3 text-left transition-colors",
        selected ? "bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      {body}
    </button>
  );
}