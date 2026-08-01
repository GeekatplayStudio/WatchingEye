"use client";

/**
 * Cross-camera identity registry: who the system knows, and on which
 * cameras they have been seen. Matching is camera-agnostic — the same UUID
 * continues when a person moves from front to backyard.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SectionHeading, StatStrip, type Stat } from "@/components/ui/page-header";
import { Fingerprint } from "lucide-react";

/** One memory entry on an identity timeline. */
interface MemoryEntry {
  at: string;
  camera_id: string;
  matched: string[];
}

/** Identity plus multi-camera summary from the engine. */
interface IdentitySummary {
  id: string;
  name: string | null;
  class: string;
  first_seen: string;
  last_seen: string;
  sightings: number;
  status?: "tentative" | "confirmed";
  memory: MemoryEntry[];
  cameras_seen: string[];
  multi_camera: boolean;
}

interface Listing {
  identities: IdentitySummary[];
}

async function fetchIdentities(): Promise<Listing> {
  const res = await fetch("/engine/api/identities");
  if (!res.ok) throw new Error(`engine ${res.status}`);
  return res.json() as Promise<Listing>;
}

async function fetchIdentity(id: string): Promise<IdentitySummary> {
  const res = await fetch(`/engine/api/identities/${id}`);
  if (!res.ok) throw new Error(`engine ${res.status}`);
  return res.json() as Promise<IdentitySummary>;
}

export default function IdentitiesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["identities"],
    queryFn: fetchIdentities,
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ["identity", selectedId],
    queryFn: () => fetchIdentity(selectedId!),
    enabled: selectedId !== null,
  });

  const identities = list.data?.identities ?? [];
  const multi = identities.filter((i) => i.multi_camera).length;
  const stats: Stat[] = [
    { label: "Known", value: identities.length, suffix: "identities" },
    {
      label: "Multi-cam",
      value: multi,
      suffix: "across cameras",
      tone: multi > 0 ? "good" : "default",
    },
  ];

  const selected = detail.data ?? identities.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="WatchingEye · Identity"
        title="Cross-camera registry"
        lede="One UUID follows a person or vehicle across cameras via appearance and attributes. Open an identity to see its camera timeline."
      />

      <StatStrip stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <SectionHeading title="Identities" tag="gallery" note={`${identities.length} known`} />
          {list.isError ? (
            <Card>
              <CardContent className="font-mono text-xs text-danger">
                Engine unreachable — start vision-engine to load the registry.
              </CardContent>
            </Card>
          ) : identities.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No identities yet. Classify a gated subject or run detect with identify enabled.
            </p>
          ) : (
            <ul className="space-y-2">
              {identities.map((id) => (
                <li key={id.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(id.id)}
                    className={`w-full rounded-sm border px-3 py-2 text-left transition-colors ${
                      selectedId === id.id
                        ? "border-accent bg-muted/60"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium capitalize">
                        <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                        {id.name ?? `${id.class} · ${id.id.slice(0, 8)}`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {id.multi_camera && <Badge variant="outline">multi-cam</Badge>}
                        <Badge variant="outline">{id.status ?? "tentative"}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
                      {id.sightings} sightings · cams:{" "}
                      {id.cameras_seen.length > 0 ? id.cameras_seen.join(", ") : "—"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Camera timeline"
            tag="history"
            note={selected ? selected.id.slice(0, 8) : "select one"}
          />
          {selected === null ? (
            <p className="font-mono text-xs text-muted-foreground">
              Select an identity to see when and where it was observed.
            </p>
          ) : (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium capitalize">
                    {selected.name ?? selected.class}
                  </p>
                  <p className="font-mono text-[0.65rem] text-muted-foreground">
                    {selected.cameras_seen.join(" · ") || "single camera"}
                  </p>
                </div>
                <ol className="space-y-2 border-l border-border pl-3">
                  {[...selected.memory].reverse().map((m, i) => (
                    <li key={`${m.at}-${m.camera_id}-${i}`} className="relative space-y-0.5">
                      <span className="absolute -left-[0.91rem] top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                      <p className="font-mono text-[0.7rem] text-foreground">{m.camera_id}</p>
                      <p className="font-mono text-[0.65rem] text-muted-foreground">
                        {new Date(m.at).toLocaleString()}
                        {m.matched.length > 0
                          ? ` · matched ${m.matched.join(", ").replaceAll("_", " ")}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
