"use client";

/**
 * Live Monitor: camera grid, connection status, and the real-time
 * detection feed with per-event evidence (zero-black-box view).
 * Selecting an event opens its stored receipt and reconstructed pipeline path.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SectionHeading, StatStrip, type Stat } from "@/components/ui/page-header";
import { EventCard } from "@/components/event-card";
import { EventDetail } from "@/components/event-detail";
import { useLiveEvents } from "@/lib/use-live-events";
import type { Camera } from "@/lib/types";
import { Video } from "lucide-react";

export default function MonitorPage() {
  const { events, connected } = useLiveEvents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cameras = useQuery({
    queryKey: ["cameras"],
    queryFn: async (): Promise<{ cameras: Camera[] }> => {
      const res = await fetch("/api/cameras");
      if (!res.ok) throw new Error(`gateway ${res.status}`);
      return res.json() as Promise<{ cameras: Camera[] }>;
    },
  });

  const list = cameras.data?.cameras ?? [];
  const refused = events.filter((e) => e.rejectedReason !== undefined).length;
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const stats: Stat[] = [
    { label: "Events", value: events.length, suffix: "in view" },
    { label: "Cameras", value: list.length, suffix: "registered" },
    { label: "Refused", value: refused, suffix: "by guardrails", tone: refused > 0 ? "warn" : "good" },
    {
      label: "Gateway",
      value: connected ? "live" : "offline",
      tone: connected ? "good" : "bad",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow={`WatchingEye · Live monitor · ${new Date().toLocaleDateString()}`}
        title="Detection feed"
        lede="Every event below carries the evidence that produced it — the claimed class, the frames it was seen in, and the model that spoke. Select one to inspect the stored receipt and reconstructed pipeline path."
        actions={
          <StatusBadge variant={connected ? "success" : "danger"} filled={connected}>
            {connected ? "live" : "disconnected"}
          </StatusBadge>
        }
      />

      <StatStrip stats={stats} />

      <section className="space-y-3">
        <SectionHeading
          title="Cameras"
          tag="registered"
          note={`${list.length} source${list.length === 1 ? "" : "s"}`}
        />
        {cameras.isError ? (
          <Card>
            <CardContent className="font-mono text-xs text-danger">
              Gateway unreachable — start it with <span className="tok">scripts/run gateway</span>.
            </CardContent>
          </Card>
        ) : list.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">No cameras registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {list.map((cam) => (
              <Card key={cam.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex aspect-video items-center justify-center rounded-sm border border-border bg-muted/40">
                    <Video className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{cam.location}</span>
                    <Badge variant="outline">{cam.kind}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <SectionHeading
            title="Event stream"
            tag="rest · ws"
            note={`${events.length} held in view`}
          />
          <Card>
            <div className="row-list max-h-[32rem] overflow-y-auto">
              {events.length === 0 ? (
                <p className="px-4 py-6 font-mono text-xs text-muted-foreground">
                  Waiting for events — hydrating recent from the gateway, then live WS…
                </p>
              ) : (
                events.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    selected={selectedId === e.id}
                    onSelect={(ev) =>
                      setSelectedId((cur) => (cur === ev.id ? null : ev.id))
                    }
                  />
                ))
              )}
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Decision receipt"
            tag="replay"
            note={selected ? selected.id.slice(0, 8) : "select an event"}
          />
          {selected === null ? (
            <p className="font-mono text-xs text-muted-foreground">
              Select an event to see its evidence, identity verdict, provenance, and
              which stages of the deterministic DAG it must have passed.
            </p>
          ) : (
            <EventDetail event={selected} onClose={() => setSelectedId(null)} />
          )}
        </section>
      </div>
    </div>
  );
}