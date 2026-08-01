"use client";

/**
 * Stored-event receipt: evidence, identity, provenance, and a compact
 * reconstruction of which deterministic pipeline stages this event must
 * have passed. Snapshot image bytes are not retained.
 */
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DetectionEvent } from "@/lib/types";

type StageState = "passed" | "failed" | "filtered" | "skipped" | "idle";

interface PipelineStage {
  name: string;
  state: StageState;
  note?: string;
}

/**
 * Reconstruct the static DAG path from stored fields only.
 * Order matches `app/pipeline/page.tsx` (+ Identity after Guardrails).
 */
export function pipelinePathFor(event: DetectionEvent): PipelineStage[] {
  const superAgentRan =
    event.model !== "unclassified" ||
    event.promptVersion !== undefined ||
    event.provenance !== undefined ||
    event.evidence.length > 0;
  const refused = event.rejectedReason !== undefined && event.rejectedReason !== "";
  const hasIdentity = event.identity !== undefined;
  const filtered = event.filtered === true;
  const actionable = superAgentRan && !refused && !filtered;

  return [
    { name: "Camera", state: "passed" },
    { name: "Motion Detection", state: "passed" },
    { name: "Object Detector", state: "passed" },
    { name: "Confidence Validator", state: "passed" },
    { name: "Temporal Validator", state: "passed" },
    { name: "Tracker", state: "passed" },
    { name: "Trigger Gate", state: "passed" },
    {
      name: "Super Agent",
      state: superAgentRan ? "passed" : "skipped",
      note: superAgentRan ? event.model : "no classify on record",
    },
    {
      name: "Guardrails",
      state: refused ? "failed" : superAgentRan ? "passed" : "skipped",
      note: refused ? event.rejectedReason : undefined,
    },
    {
      name: "Identity",
      state: hasIdentity ? "passed" : "skipped",
      note: hasIdentity
        ? (event.identity!.name ?? event.identity!.id.slice(0, 8))
        : undefined,
    },
    {
      name: "Rule Engine",
      state: filtered ? "filtered" : superAgentRan && !refused ? "passed" : "skipped",
      note: filtered ? "policy filter — recorded, not alerted" : undefined,
    },
    {
      name: "Actions",
      state: actionable ? "passed" : "skipped",
      note: actionable ? undefined : "no allowlisted action fired",
    },
  ];
}

function stageVariant(
  state: StageState,
): "success" | "danger" | "warning" | "outline" | "default" {
  switch (state) {
    case "passed":
      return "success";
    case "failed":
      return "danger";
    case "filtered":
      return "warning";
    default:
      return "outline";
  }
}

function stageLabel(state: StageState): string {
  switch (state) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "filtered":
      return "filtered";
    case "skipped":
      return "skipped";
    default:
      return "—";
  }
}

export function EventDetail({
  event,
  onClose,
}: {
  event: DetectionEvent;
  onClose?: () => void;
}) {
  const stages = pipelinePathFor(event);
  const provenance = event.provenance;
  const prompt =
    provenance?.prompt_version ?? event.promptVersion ?? undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event receipt</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{event.id.slice(0, 12)}</Badge>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              close
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
          Reconstructs the stored decision path from fields on this event.
          Snapshot image bytes are not retained — there is no re-run.
        </p>

        <div className="flex flex-wrap gap-2">
          <StatusBadge
            variant={
              event.rejectedReason
                ? "danger"
                : event.filtered
                  ? "warning"
                  : "success"
            }
          >
            {event.rejectedReason
              ? "refused"
              : event.filtered
                ? "filtered"
                : "accepted"}
          </StatusBadge>
          <Badge variant="outline" className="capitalize">
            {event.class}
          </Badge>
          <Badge variant="outline">{(event.confidence * 100).toFixed(1)}%</Badge>
          {event.risk !== undefined && (
            <Badge variant="outline">risk {(event.risk * 100).toFixed(0)}%</Badge>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.7rem]">
          <dt className="text-muted-foreground">camera</dt>
          <dd>
            <span className="tok">{event.cameraId}</span>
          </dd>
          <dt className="text-muted-foreground">frames</dt>
          <dd>{event.frames.join(", ") || "—"}</dd>
          <dt className="text-muted-foreground">object</dt>
          <dd className="truncate">{event.objectId}</dd>
          <dt className="text-muted-foreground">model</dt>
          <dd>
            <span className="tok">{event.model}</span>
          </dd>
          {prompt && (
            <>
              <dt className="text-muted-foreground">prompt</dt>
              <dd>
                <span className="tok">{prompt}</span>
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">time</dt>
          <dd>{new Date(event.timestamp).toLocaleString()}</dd>
          {event.rejectedReason && (
            <>
              <dt className="text-muted-foreground">refusal</dt>
              <dd className="text-danger">{event.rejectedReason}</dd>
            </>
          )}
        </dl>

        {provenance && (
          <section className="space-y-2">
            <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Provenance
            </h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[0.7rem]">
              <dt className="text-muted-foreground">model_version</dt>
              <dd>{provenance.model_version}</dd>
              <dt className="text-muted-foreground">prompt_version</dt>
              <dd>{provenance.prompt_version}</dd>
              <dt className="text-muted-foreground">timestamp</dt>
              <dd>{new Date(provenance.timestamp).toLocaleString()}</dd>
              {provenance.input_images.length > 0 && (
                <>
                  <dt className="text-muted-foreground">input_images</dt>
                  <dd className="truncate">{provenance.input_images.join(", ")}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {event.identity && (
          <section className="space-y-2">
            <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Identity verdict
            </h4>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="success">
                {event.identity.name ?? event.identity.id.slice(0, 8)}
              </Badge>
              {event.identity.isNew && <Badge variant="warning">new</Badge>}
              {event.identity.status && (
                <Badge variant="outline">{event.identity.status}</Badge>
              )}
              {event.identity.quality && (
                <Badge variant="outline">{event.identity.quality}</Badge>
              )}
              {event.identity.crossedCamera && (
                <Badge variant="outline">crossed camera</Badge>
              )}
            </div>
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              {event.identity.sightings} sightings
              {event.identity.score !== undefined
                ? ` · score ${(event.identity.score * 100).toFixed(1)}%`
                : ""}
              {event.identity.matched && event.identity.matched.length > 0
                ? ` · matched ${event.identity.matched.join(", ").replaceAll("_", " ")}`
                : ""}
            </p>
          </section>
        )}

        {event.descriptors && event.descriptors.length > 0 && (
          <section className="space-y-2">
            <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Descriptors
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {event.descriptors.map((d) => (
                <Badge key={`${d.key}:${d.value}`} variant="outline">
                  {d.key.replaceAll("_", " ")}: {d.value}
                </Badge>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
            Evidence
          </h4>
          {event.evidence.length === 0 ? (
            <p className="font-mono text-[0.7rem] text-muted-foreground">No evidence stored.</p>
          ) : (
            <ul className="space-y-2">
              {event.evidence.map((e) => (
                <li key={e.label} className="border-l-2 border-border pl-3">
                  <p className="font-mono text-[0.7rem] text-foreground">
                    {e.label.replaceAll("_", " ")}
                  </p>
                  <p className="font-mono text-[0.65rem] text-muted-foreground">
                    {e.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline path
          </h4>
          <ol className="space-y-1">
            {stages.map((stage) => (
              <li
                key={stage.name}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-sm px-2 py-1.5",
                  stage.state === "passed" && "bg-primary/5",
                  stage.state === "failed" && "bg-danger/10",
                  stage.state === "filtered" && "bg-accent/10",
                  (stage.state === "skipped" || stage.state === "idle") && "opacity-50",
                )}
              >
                <span className="min-w-[9rem] text-sm font-medium">{stage.name}</span>
                <Badge variant={stageVariant(stage.state)}>{stageLabel(stage.state)}</Badge>
                {stage.note && (
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    {stage.note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}