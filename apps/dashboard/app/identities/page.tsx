"use client";

/**
 * Cross-camera identity registry & Action/Behavior Registration.
 *
 * One UUID follows a person or vehicle across cameras via appearance and attributes.
 * Users can register person names (e.g. "Alex (Owner)", "John (Delivery)") and configure
 * custom behavior/action triggers (e.g. waving, loitering, crouching, fighting).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SectionHeading, StatStrip, type Stat } from "@/components/ui/page-header";
import { Fingerprint, UserCheck, ShieldAlert, Activity, Plus, Check, Edit2, Tag } from "lucide-react";

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

/** Registered Custom Action / Behavior rule. */
interface RegisteredAction {
  id: string;
  name: string;
  category: "behavior" | "posture" | "gesture" | "security";
  description: string;
  confidenceThreshold: number;
  enabled: boolean;
  priority: "low" | "medium" | "high" | "critical";
}

const DEFAULT_ACTIONS: RegisteredAction[] = [
  {
    id: "act-waving",
    name: "Waving Hand / Signaling",
    category: "gesture",
    description: "Subject waving hand in air, signaling for attention or assistance",
    confidenceThreshold: 0.85,
    enabled: true,
    priority: "medium",
  },
  {
    id: "act-looking",
    name: "Looking / Peering closely",
    category: "behavior",
    description: "Subject inspecting entry points, doors, or windows intently",
    confidenceThreshold: 0.80,
    enabled: true,
    priority: "low",
  },
  {
    id: "act-loitering",
    name: "Loitering in Zone (>30s)",
    category: "security",
    description: "Subject remaining stationary or pacing back and forth in restricted area",
    confidenceThreshold: 0.90,
    enabled: true,
    priority: "high",
  },
  {
    id: "act-crouching",
    name: "Crouching / Sneaking",
    category: "posture",
    description: "Subject bent low to ground or crouching behind obstacles",
    confidenceThreshold: 0.88,
    enabled: true,
    priority: "high",
  },
  {
    id: "act-running",
    name: "Running / Fleeing",
    category: "behavior",
    description: "Fast sprinting movement across scene or away from camera",
    confidenceThreshold: 0.85,
    enabled: true,
    priority: "medium",
  },
  {
    id: "act-fighting",
    name: "Fighting / Altercation",
    category: "security",
    description: "Physical violence, punching, wrestling, or aggressive grappling",
    confidenceThreshold: 0.92,
    enabled: true,
    priority: "critical",
  },
  {
    id: "act-falling",
    name: "Falling / Slip Medical Alert",
    category: "security",
    description: "Subject collapsing or falling to the ground suddenly",
    confidenceThreshold: 0.90,
    enabled: true,
    priority: "critical",
  },
];

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

async function nameIdentity(id: string, name: string): Promise<void> {
  const res = await fetch("/engine/api/identities/name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  if (!res.ok) throw new Error(`Failed to assign name to identity (${res.status})`);
}

export default function IdentitiesPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [namingId, setNamingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState<string>("");
  const [roleInput, setRoleInput] = useState<string>("Owner");
  const [customActions, setCustomActions] = useState<RegisteredAction[]>(DEFAULT_ACTIONS);
  const [showAddAction, setShowAddAction] = useState<boolean>(false);
  const [newActionName, setNewActionName] = useState<string>("");
  const [newActionDesc, setNewActionDesc] = useState<string>("");

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

  const nameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => nameIdentity(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["identities"] });
      void queryClient.invalidateQueries({ queryKey: ["identity", selectedId] });
      setNamingId(null);
      setNameInput("");
    },
  });

  const handleNameSubmit = (id: string) => {
    if (!nameInput.trim()) return;
    const fullName = `${nameInput.trim()} (${roleInput})`;
    nameMutation.mutate({ id, name: fullName });
  };

  const handleAddCustomAction = () => {
    if (!newActionName.trim()) return;
    const action: RegisteredAction = {
      id: `act-custom-${Date.now()}`,
      name: newActionName.trim(),
      category: "behavior",
      description: newActionDesc.trim() || "User registered custom behavior action",
      confidenceThreshold: 0.85,
      enabled: true,
      priority: "high",
    };
    setCustomActions([action, ...customActions]);
    setNewActionName("");
    setNewActionDesc("");
    setShowAddAction(false);
  };

  const toggleActionEnabled = (id: string) => {
    setCustomActions(
      customActions.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const identities = list.data?.identities ?? [];
  const multi = identities.filter((i) => i.multi_camera).length;
  const namedCount = identities.filter((i) => i.name !== null).length;

  const stats: Stat[] = [
    { label: "Known", value: identities.length, suffix: "identities" },
    { label: "Registered", value: namedCount, suffix: "named persons", tone: namedCount > 0 ? "good" : "default" },
    { label: "Actions", value: customActions.filter((a) => a.enabled).length, suffix: "active triggers" },
    {
      label: "Multi-cam",
      value: multi,
      suffix: "across cameras",
      tone: multi > 0 ? "good" : "default",
    },
  ];

  const selected = detail.data ?? identities.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12 font-mono text-xs">
      <PageHeader
        eyebrow="WatchingEye · Identity & Action Registry"
        title="Person Recognition & Registered Actions"
        lede="Register recognized person identities (e.g. Owner, Family, Delivery Driver) and configure real-time action/behavior triggers for live surveillance alerts."
      />

      <StatStrip stats={stats} />

      {/* Main Grid: Persons Registry & Camera Timeline */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Person Identity List */}
        <section className="space-y-3">
          <SectionHeading title="Registered Person & Vehicle Identities" tag="registry" note={`${identities.length} total`} />
          {list.isError ? (
            <Card>
              <CardContent className="p-4 font-mono text-xs text-danger">
                Engine unreachable — start vision-engine to load the registry.
              </CardContent>
            </Card>
          ) : identities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <Fingerprint className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="font-bold">No identities recorded yet</p>
              <p className="text-[0.65rem] mt-1">Classify a subject on the Live Console or enable person tracking.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {identities.map((id) => (
                <li key={id.id} className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-purple-500/40">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(id.id)}
                      className="flex items-center gap-2 text-sm font-semibold capitalize hover:text-purple-400"
                    >
                      <Fingerprint className="h-4 w-4 text-purple-400 shrink-0" />
                      {id.name ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-emerald-400" /> {id.name}
                        </span>
                      ) : (
                        <span>{id.class} · {id.id.slice(0, 8)}</span>
                      )}
                    </button>
                    <div className="flex items-center gap-1.5">
                      {id.multi_camera && <Badge variant="outline" className="text-[0.6rem] border-purple-500/50 text-purple-300">multi-cam</Badge>}
                      <button
                        onClick={() => {
                          setNamingId(namingId === id.id ? null : id.id);
                          setNameInput(id.name ? id.name.split(" (")[0] : "");
                        }}
                        className="flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[0.65rem] font-bold text-purple-300 hover:bg-purple-500/20"
                      >
                        <Edit2 className="h-3 w-3" /> {id.name ? "Edit Name" : "Register Name"}
                      </button>
                    </div>
                  </div>

                  {/* Inline Naming Form */}
                  {namingId === id.id && (
                    <div className="mt-3 rounded border border-purple-500/30 bg-purple-950/20 p-2.5 space-y-2">
                      <p className="font-bold text-purple-300">Register Person Identity Name:</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          placeholder="e.g. Alex, Security Officer, Delivery"
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          className="flex-1 min-w-[140px] rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <select
                          value={roleInput}
                          onChange={(e) => setRoleInput(e.target.value)}
                          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                        >
                          <option value="Owner">Owner</option>
                          <option value="Family">Family Member</option>
                          <option value="Staff">Authorized Staff</option>
                          <option value="Delivery">Delivery Driver</option>
                          <option value="VIP">VIP Guest</option>
                          <option value="Unknown">Untrusted Person</option>
                        </select>
                        <button
                          onClick={() => handleNameSubmit(id.id)}
                          disabled={nameMutation.isPending}
                          className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1 text-xs font-bold text-white hover:bg-purple-500 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" /> Save Identity
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="mt-2 text-[0.65rem] text-muted-foreground flex items-center gap-2">
                    <span>{id.sightings} sightings</span>
                    <span>·</span>
                    <span>Cams: {id.cameras_seen.length > 0 ? id.cameras_seen.join(", ") : "—"}</span>
                    <span>·</span>
                    <span>Last: {new Date(id.last_seen).toLocaleTimeString()}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Selected Identity Detail & Memory Timeline */}
        <section className="space-y-3">
          <SectionHeading
            title="Identity Sighting Timeline"
            tag="history"
            note={selected ? selected.id.slice(0, 8) : "select an identity"}
          />
          {selected === null ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <Activity className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                <p>Select an identity on the left to inspect multi-camera sightings & attribute matches.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-purple-500/30">
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <p className="text-sm font-bold text-emerald-400 capitalize">
                      {selected.name ?? `${selected.class} (${selected.id.slice(0, 8)})`}
                    </p>
                    <p className="text-[0.65rem] text-muted-foreground">
                      First seen: {new Date(selected.first_seen).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-purple-500/50 text-purple-300">
                    {selected.cameras_seen.length} Camera(s)
                  </Badge>
                </div>

                <div className="space-y-2">
                  <p className="font-bold text-muted-foreground uppercase text-[0.65rem]">Recorded Camera Timeline:</p>
                  <ol className="space-y-2.5 border-l border-purple-500/30 pl-3">
                    {[...selected.memory].reverse().map((m, i) => (
                      <li key={`${m.at}-${m.camera_id}-${i}`} className="relative space-y-0.5">
                        <span className="absolute -left-[0.91rem] top-1.5 h-2 w-2 rounded-full bg-purple-400" />
                        <p className="font-bold text-foreground">{m.camera_id}</p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {new Date(m.at).toLocaleString()}
                          {m.matched.length > 0
                            ? ` · Matched features: ${m.matched.join(", ").replaceAll("_", " ")}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      {/* Section 2: Action & Behavior Trigger Registry */}
      <section className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" /> Action & Behavior Trigger Registry
            </h3>
            <p className="text-[0.65rem] text-muted-foreground">
              Define custom action recognitions (e.g. Waving Hand, Loitering, Fighting) for automated live AI rules.
            </p>
          </div>
          <button
            onClick={() => setShowAddAction(!showAddAction)}
            className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-bold text-amber-300 hover:bg-amber-500/20"
          >
            <Plus className="h-3.5 w-3.5" /> Register Custom Action
          </button>
        </div>

        {/* Add Custom Action Form */}
        {showAddAction && (
          <Card className="border-amber-500/40 bg-amber-950/10">
            <CardContent className="p-4 space-y-3">
              <p className="font-bold text-amber-300 text-xs">Register New Custom Action Trigger:</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[0.65rem] text-muted-foreground uppercase">Action Name:</label>
                  <input
                    type="text"
                    placeholder="e.g. Standing Near Safe, Climbing Fence"
                    value={newActionName}
                    onChange={(e) => setNewActionName(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[0.65rem] text-muted-foreground uppercase">Action Description:</label>
                  <input
                    type="text"
                    placeholder="Brief prompt for VLM behavior matching..."
                    value={newActionDesc}
                    onChange={(e) => setNewActionDesc(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddAction(false)}
                  className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCustomAction}
                  className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-xs font-bold text-black hover:bg-amber-400"
                >
                  <Check className="h-3.5 w-3.5" /> Add Action Trigger
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Trigger Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customActions.map((action) => (
            <div
              key={action.id}
              className={`flex flex-col justify-between rounded-lg border p-3 transition-all ${
                action.enabled
                  ? "border-amber-500/30 bg-card hover:border-amber-500/60"
                  : "border-border/60 bg-card/40 opacity-60"
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    {action.name}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[0.6rem] uppercase ${
                      action.priority === "critical"
                        ? "border-red-500/60 text-red-400 bg-red-500/10"
                        : action.priority === "high"
                        ? "border-amber-500/60 text-amber-400 bg-amber-500/10"
                        : "border-sky-500/60 text-sky-400 bg-sky-500/10"
                    }`}
                  >
                    {action.priority}
                  </Badge>
                </div>
                <p className="text-[0.65rem] text-muted-foreground leading-normal">{action.description}</p>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[0.65rem]">
                <span className="text-muted-foreground">
                  Threshold: <strong className="text-amber-300">{(action.confidenceThreshold * 100).toFixed(0)}%</strong>
                </span>
                <button
                  onClick={() => toggleActionEnabled(action.id)}
                  className={`rounded px-2 py-0.5 text-[0.6rem] font-bold ${
                    action.enabled
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {action.enabled ? "Active" : "Disabled"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
