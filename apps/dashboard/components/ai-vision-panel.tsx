"use client";

/**
 * "What the AI sees" — the running commentary beside the video.
 *
 * Two layers, kept visually distinct because they carry different weight:
 * what the deterministic pipeline is tracking right now (always true), and
 * what the vision model concluded when the gate last opened (validated, but
 * a model's opinion).
 */
import { Badge } from "@/components/ui/badge";
import { Eye, Brain, ShieldAlert, Fingerprint } from "lucide-react";
import type { Classification, FrameOutcome } from "@/lib/use-webcam-pipeline";

/** Plain-language summary of the current frame. */
function nowSeeing(outcome: FrameOutcome | null, connected: boolean): string {
  if (!connected) return "No camera connected.";
  if (outcome === null) return "Waiting for the first frame…";
  if (outcome.rejected_reason !== null) return outcome.rejected_reason;
  const n = outcome.regions.length;
  if (n === 0) {
    return outcome.motion
      ? "Movement, but nothing large enough to track."
      : "Scene is still. Nothing moving.";
  }
  const gated = outcome.regions.filter((r) => r.gate_open).length;
  const noun = n === 1 ? "moving object" : "moving objects";
  return gated > 0
    ? `Tracking ${n} ${noun}; ${gated} confirmed long enough to identify.`
    : `Tracking ${n} ${noun}, still confirming.`;
}

export function AiVisionPanel({
  outcome,
  connected,
  classifications,
  classifying,
}: {
  outcome: FrameOutcome | null;
  connected: boolean;
  classifications: Classification[];
  classifying: boolean;
}) {
  const latest = classifications[0];
  return (
    <div className="flex h-full flex-col gap-3">
      <section>
        <h3 className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium">
          <Eye className="h-3.5 w-3.5 text-primary" /> Right now
        </h3>
        <p className="text-sm leading-snug">{nowSeeing(outcome, connected)}</p>
        {outcome !== null && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge variant={outcome.motion ? "warning" : "default"}>
              {outcome.motion ? "motion" : "still"}
            </Badge>
            <Badge variant="outline">frame {outcome.frame}</Badge>
            <Badge variant="outline">
              {(outcome.changed_ratio * 100).toFixed(1)}% foreground
            </Badge>
          </div>
        )}
      </section>

      <section className="border-t border-border pt-3">
        <h3 className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium">
          <Brain className="h-3.5 w-3.5 text-primary" /> What the AI recognized
          {classifying && (
            <span className="ml-1 text-[10px] font-normal text-warning">thinking…</span>
          )}
        </h3>

        {latest === undefined ? (
          <p className="text-sm leading-snug text-muted-foreground">
            Nothing yet. The vision model only runs once an object has persisted long enough —
            move into view and hold still for a moment.
          </p>
        ) : latest.rejectedReason !== undefined ? (
          <div className="space-y-1">
            <p className="inline-flex items-center gap-1.5 text-sm text-danger">
              <ShieldAlert className="h-3.5 w-3.5" /> Refused — nothing trustworthy concluded
            </p>
            <p className="text-xs text-muted-foreground">{latest.rejectedReason}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm">
              <span className="font-medium capitalize">
                {latest.identity?.name ?? latest.label}
              </span>
              {latest.identity?.name != null && (
                <span className="text-muted-foreground"> ({latest.label})</span>
              )}
              <span className="text-muted-foreground">
                {" "}
                · {(latest.confidence * 100).toFixed(0)}% sure
              </span>
            </p>

            {latest.descriptors !== undefined && latest.descriptors.length > 0 && (
              <p className="text-sm leading-snug text-muted-foreground">
                I can see:{" "}
                {latest.descriptors
                  .map((d) => `${d.key.replaceAll("_", " ")} ${d.value.replaceAll("_", " ")}`)
                  .join(", ")}
                .
              </p>
            )}

            {latest.identity !== undefined && (
              <p className="inline-flex items-center gap-1.5 text-xs">
                <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                {latest.identity.ambiguous === true ? (
                  <span className="text-muted-foreground">
                    Ambiguous match — holding appearance memory steady.
                  </span>
                ) : latest.identity.isNew ? (
                  <span className="text-muted-foreground">
                    First time I have seen this one
                    {latest.identity.status === "tentative" ? " (tentative)" : ""}.
                  </span>
                ) : latest.identity.crossedCamera === true ? (
                  <span className="text-primary">
                    Same individual — crossed from another camera
                    {latest.identity.camerasSeen !== undefined &&
                    latest.identity.camerasSeen.length > 0
                      ? ` (${latest.identity.camerasSeen.join(" → ")})`
                      : ""}
                    .
                  </span>
                ) : (
                  <span className="text-primary">
                    Seen {latest.identity.sightings} times before
                    {latest.identity.status === "tentative" ? " (tentative)" : ""}
                    {latest.identity.matched !== undefined && latest.identity.matched.length > 0
                      ? ` — recognized by ${latest.identity.matched
                          .join(", ")
                          .replaceAll("_", " ")}`
                      : ""}
                    .
                  </span>
                )}
              </p>
            )}

            {latest.evidence.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {latest.evidence
                  .filter((e) => !e.label.startsWith("class:"))
                  .map((e) => (
                    <Badge key={e.label} title={e.description}>
                      {e.label.replaceAll("_", " ")}
                    </Badge>
                  ))}
              </div>
            )}

            <p className="font-mono text-[10px] text-muted-foreground">
              {latest.model}
              {latest.latencyMs !== undefined
                ? ` · ${(latest.latencyMs / 1000).toFixed(1)}s`
                : ""}{" "}
              · {new Date(latest.at).toLocaleTimeString()}
            </p>
          </div>
        )}
      </section>

      {classifications.length > 1 && (
        <section className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-3">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Earlier</h3>
          <ul className="space-y-1">
            {classifications.slice(1, 8).map((c) => (
              <li key={`${c.objectId}-${c.at}`} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  {new Date(c.at).toLocaleTimeString()}
                </span>
                <span className="capitalize">{c.identity?.name ?? c.label}</span>
                {c.rejectedReason !== undefined && <Badge variant="danger">refused</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
