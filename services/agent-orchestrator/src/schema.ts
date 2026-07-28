/**
 * Zod schemas mirroring the Rust `schemas` crate — the TypeScript half of
 * the guardrail contract. Any VLM/LLM output that does not parse against
 * `AgentDecisionSchema` is rejected before it can influence anything.
 */
import { z } from "zod";

/** Evidence item: enumerated, never prose blobs. */
export const EvidenceSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

/** Zero-black-box provenance, required on every decision. */
export const ProvenanceSchema = z.object({
  model_version: z.string().min(1),
  prompt_version: z.string().min(1),
  input_images: z.array(z.string()),
  timestamp: z.string().datetime(),
});

/** A structured agent decision (mirrors `schemas::AgentDecision`). */
export const AgentDecisionSchema = z.object({
  id: z.string().uuid(),
  object_id: z.string().uuid(),
  risk: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
  confidence: z.number().min(0).max(1),
  proposed_action: z.string().min(1),
  provenance: ProvenanceSchema,
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/** Validated event that may trigger the agent (post-TriggerGate only). */
export const TriggerEventSchema = z.object({
  objectId: z.string().min(1),
  class: z.string().min(1),
  confidence: z.number().min(0).max(1),
  frames: z.array(z.number().int()).min(1),
  cameraId: z.string().min(1),
  snapshotRef: z.string().min(1),
});

export type TriggerEvent = z.infer<typeof TriggerEventSchema>;
