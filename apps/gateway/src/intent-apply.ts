/**
 * Apply `settings.activeIntent` to a classified event.
 *
 * Deterministic only — filters descriptors, optional regex ANPR, and decides
 * whether the sighting is enrolled into the dataset. No LLM.
 */
import { extractLicensePlate } from "./anpr.js";
import type { ActiveTrackingIntent } from "./settings.js";

export interface Descriptor {
  key: string;
  value: string;
}

export interface EvidenceItem {
  label: string;
  description: string;
}

export interface IntentApplyInput {
  objectClass: string;
  descriptors: Descriptor[];
  evidence: EvidenceItem[];
  /** Orchestrator raw VLM text, when present. */
  rawAnalysis?: string;
  /**
   * Plate already resolved by the orchestrator OCR path. Preferred over
   * local regex when present.
   */
  plate?: {
    plateText: string;
    confidence: number;
    confirmed: boolean;
    source: "ocr" | "regex_vlm";
    ocrModel?: string;
  } | null;
  intent: ActiveTrackingIntent | null;
}

export interface IntentApplyResult {
  descriptors: Descriptor[];
  evidence: EvidenceItem[];
  licensePlate?: string;
  breedOrModel?: string;
  /** Enroll into dataset store when true. */
  shouldEnroll: boolean;
  /** Plate seen but not confirmed. */
  ocrUnconfirmed: boolean;
}

/**
 * Shape classify output according to the active NL tracking intent.
 *
 * @example
 * applyActiveIntent({ objectClass: "car", descriptors: [], evidence: [], intent: null }).shouldEnroll
 * // true — no intent means default enroll-on-classify
 */
export function applyActiveIntent(input: IntentApplyInput): IntentApplyResult {
  const intent = input.intent;
  let descriptors = [...input.descriptors];
  let evidence = [...input.evidence];
  let licensePlate: string | undefined;
  let ocrUnconfirmed = false;

  const plateFromEvidence = evidence
    .find((e) => e.label.startsWith("plate:"))
    ?.label.replace("plate:", "");
  if (plateFromEvidence !== undefined && plateFromEvidence !== "") {
    licensePlate = plateFromEvidence.toUpperCase();
  }

  if (intent?.anprEnabled === true && input.plate != null) {
    licensePlate = input.plate.plateText;
    ocrUnconfirmed = !input.plate.confirmed;
    if (!descriptors.some((d) => d.key === "license_plate")) {
      descriptors.push({ key: "license_plate", value: input.plate.plateText.toLowerCase() });
    }
    const sourceNote =
      input.plate.source === "ocr"
        ? `OCR (${input.plate.ocrModel ?? "ocr"})`
        : "regex over VLM text";
    if (!evidence.some((e) => e.label.startsWith("plate:"))) {
      evidence = [
        ...evidence,
        {
          label: `plate:${input.plate.plateText}`,
          description: input.plate.confirmed
            ? `ANPR ${sourceNote} matched ${input.plate.plateText} (${input.plate.confidence.toFixed(2)})`
            : `ANPR weak match ${input.plate.plateText} — ocr_unconfirmed`,
        },
      ];
    }
    if (ocrUnconfirmed && !evidence.some((e) => e.label === "ocr_unconfirmed")) {
      evidence = [
        ...evidence,
        {
          label: "ocr_unconfirmed",
          description: `Plate ${input.plate.plateText} below confirmation floor`,
        },
      ];
    }
  } else if (intent?.anprEnabled === true && licensePlate === undefined) {
    const haystack = [
      input.rawAnalysis ?? "",
      ...descriptors.map((d) => `${d.key} ${d.value}`),
      ...evidence.map((e) => `${e.label} ${e.description}`),
    ].join(" ");
    const hit = extractLicensePlate(haystack);
    if (hit !== null) {
      licensePlate = hit.plateText;
      ocrUnconfirmed = !hit.confirmed;
      if (!descriptors.some((d) => d.key === "license_plate")) {
        descriptors.push({ key: "license_plate", value: hit.plateText.toLowerCase() });
      }
      if (!evidence.some((e) => e.label.startsWith("plate:"))) {
        evidence = [
          ...evidence,
          {
            label: `plate:${hit.plateText}`,
            description: hit.confirmed
              ? `ANPR matched ${hit.plateText} (${hit.confidence.toFixed(2)})`
              : `ANPR weak match ${hit.plateText} — ocr_unconfirmed`,
          },
        ];
      }
      if (ocrUnconfirmed && !evidence.some((e) => e.label === "ocr_unconfirmed")) {
        evidence = [
          ...evidence,
          {
            label: "ocr_unconfirmed",
            description: `Plate ${hit.plateText} below confirmation floor`,
          },
        ];
      }
    }
  }

  if (intent !== null && intent.attributes.length > 0) {
    const allow = new Set(intent.attributes);
    // Always keep plates when ANPR ran or evidence already had one.
    if (licensePlate !== undefined) allow.add("license_plate");
    descriptors = descriptors.filter((d) => allow.has(d.key));
  }

  const breedOrModel = descriptors.find((d) => d.key === "breed" || d.key === "make")?.value;

  const shouldEnroll =
    intent === null ? true : intent.datasetEnroll === true || intent.anprEnabled === true;

  const out: IntentApplyResult = {
    descriptors,
    evidence,
    shouldEnroll,
    ocrUnconfirmed,
  };
  if (licensePlate !== undefined) out.licensePlate = licensePlate;
  if (breedOrModel !== undefined) out.breedOrModel = breedOrModel;
  return out;
}
