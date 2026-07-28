"use client";

/** One detection event in the live feed, with full evidence chain. */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

export function EventCard({ event }: { event: DetectionEvent }) {
  const Icon = CLASS_ICONS[event.class] ?? HelpCircle;
  return (
    <Card className="animate-in">
      <CardContent className="flex gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium capitalize">{event.class}</span>
            <span className="text-xs text-muted-foreground">
              {event.kind.replaceAll("_", " ")}
              {event.zone ? ` · ${event.zone}` : ""}
            </span>
            <Badge variant={confidenceVariant(event.confidence)}>
              {(event.confidence * 100).toFixed(1)}%
            </Badge>
            {event.source === "demo" && <Badge variant="outline">demo</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {event.evidence.map((e) => (
              <Badge key={e.label} variant="default" title={e.description}>
                {e.label.replaceAll("_", " ")}
              </Badge>
            ))}
          </div>
          <div className="mt-1.5 font-mono text-xs text-muted-foreground">
            cam:{event.cameraId} · frames {event.frames.join(", ")} · {event.model} ·{" "}
            {new Date(event.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
