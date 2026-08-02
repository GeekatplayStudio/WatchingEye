/**
 * Shared wake-word schema (split to avoid ESM cycles with the ONNX engine).
 */

import { z } from "zod";

/**
 * Closed wake keywords. Stub uses `watchingeye`; live openWakeWord maps
 * classifier basename only (e.g. `hey_jarvis_v0.1.onnx` → `hey_jarvis`).
 */
export const WakeKeywordSchema = z.enum(["watchingeye", "hey_jarvis"]);
export type WakeKeyword = z.infer<typeof WakeKeywordSchema>;

/** Validated wake hit with provenance. */
export const WakeDetectionSchema = z.object({
  keyword: WakeKeywordSchema,
  confidence: z.number().min(0).max(1),
  provenance: z.object({
    model_version: z.string().min(1),
    timestamp: z.string().min(1),
  }),
});
export type WakeDetection = z.infer<typeof WakeDetectionSchema>;
