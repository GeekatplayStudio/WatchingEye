/**
 * Natural language intent parser for dynamic target registration.
 *
 * Converts prompts like "track and register all dogs" or "track all cars and capture license plates"
 * into deterministic target filters and extraction policies.
 */

export interface ParsedTargetIntent {
  rawPrompt: string;
  targetClasses: string[];
  attributes: string[];
  actionPolicy: "dataset_enroll" | "anpr_ocr" | "monitor" | "notify";
  confidenceThreshold: number;
}

export function parseNaturalLanguageIntent(prompt: string): ParsedTargetIntent {
  const lower = prompt.toLowerCase();
  const classes = new Set<string>();
  const attributes = new Set<string>();
  let actionPolicy: ParsedTargetIntent["actionPolicy"] = "monitor";

  // Class detection patterns
  if (/\b(dog|dogs|canine|canines|pet|pets)\b/.test(lower)) {
    classes.add("dog");
    attributes.add("breed");
    attributes.add("color");
  }
  if (/\b(cat|cats|feline|felines)\b/.test(lower)) {
    classes.add("cat");
    attributes.add("breed");
    attributes.add("color");
  }
  if (/\b(car|cars|vehicle|vehicles|truck|trucks|auto|automobile)\b/.test(lower)) {
    classes.add("car");
    classes.add("truck");
    classes.add("bus");
    attributes.add("color");
    attributes.add("make");
  }
  if (/\b(person|people|stranger|human|pedestrian)\b/.test(lower)) {
    classes.add("person");
    attributes.add("apparel");
  }
  if (/\b(bicycle|bike|motorcycle)\b/.test(lower)) {
    classes.add("bicycle");
    classes.add("motorcycle");
  }

  // Feature & attribute patterns
  if (/\b(license|plate|licence|plates|number plate|anpr|ocr)\b/.test(lower)) {
    attributes.add("license_plate");
    actionPolicy = "anpr_ocr";
  }
  if (/\b(register|enroll|dataset|record|log|collect|save|store)\b/.test(lower)) {
    if (actionPolicy !== "anpr_ocr") {
      actionPolicy = "dataset_enroll";
    }
  }
  if (/\b(notify|alert|warn|alarm)\b/.test(lower)) {
    actionPolicy = "notify";
  }

  // Fallback defaults if no specific class matched
  if (classes.size === 0) {
    classes.add("moving_region");
  }

  return {
    rawPrompt: prompt,
    targetClasses: Array.from(classes),
    attributes: Array.from(attributes),
    actionPolicy,
    confidenceThreshold: 0.85,
  };
}
