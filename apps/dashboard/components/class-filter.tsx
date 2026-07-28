"use client";

/**
 * What to watch for.
 *
 * Unchecking a class does not stop the system seeing it — a sighting is
 * still detected and recorded. It stops it alerting and dims it in the feed.
 * The wording here says so, because "tracking: off" that silently discards
 * evidence would be the opposite of this project's point.
 */
import { useEffect, useState } from "react";
import {
  PersonStanding,
  Dog,
  Cat,
  Bird,
  Car,
  Truck,
  Bike,
  Plane,
  Package,
  HelpCircle,
  ListFilter,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CLASSES: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "person", label: "People", icon: PersonStanding },
  { id: "dog", label: "Dogs", icon: Dog },
  { id: "cat", label: "Cats", icon: Cat },
  { id: "bird", label: "Birds", icon: Bird },
  { id: "car", label: "Cars", icon: Car },
  { id: "truck", label: "Trucks", icon: Truck },
  { id: "bicycle", label: "Bicycles", icon: Bike },
  { id: "drone", label: "Drones", icon: Plane },
  { id: "package", label: "Packages", icon: Package },
  { id: "unknown", label: "Unknown", icon: HelpCircle },
];

export function ClassFilter() {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json() as Promise<{ trackedClasses: string[] }>)
      .then((s) => setSelected(s.trackedClasses))
      .catch(() => setError("gateway unreachable"));
  }, []);

  function toggle(id: string) {
    if (selected === null) return;
    const next = selected.includes(id)
      ? selected.filter((c) => c !== id)
      : [...selected, id];
    setSelected(next);
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackedClasses: next }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((s: { trackedClasses: string[] }) => setSelected(s.trackedClasses))
      .catch(() => setError("could not save"));
  }

  return (
    <div className="space-y-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <ListFilter className="h-3.5 w-3.5 text-primary" /> Alert on
      </span>

      {error !== null && <p className="text-[10px] text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-1">
        {CLASSES.map(({ id, label, icon: Icon }) => {
          const on = selected?.includes(id) ?? false;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              disabled={selected === null}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] transition-colors disabled:opacity-40",
                on
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border",
                  on ? "border-primary bg-primary" : "border-muted-foreground",
                )}
              >
                {on && (
                  <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden>
                    <path
                      d="M1 5l2.5 2.5L9 2"
                      fill="none"
                      stroke="hsl(var(--background))"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </span>
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Unchecked classes are still detected and recorded — they just do not alert.
      </p>
    </div>
  );
}
