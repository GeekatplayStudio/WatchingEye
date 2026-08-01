/**
 * Natural language intent parser for dynamic target registration.
 *
 * Converts prompts like "track and register all dogs" or "track all cars and
 * capture license plates" into deterministic target filters. The model never
 * chooses actions — this is keyword arithmetic the dashboard and gateway apply.
 */

/** Classes the parser may emit (must stay ⊆ gateway AVAILABLE_CLASSES). */
const KNOWN_CLASSES = [
  "person",
  "dog",
  "cat",
  "bird",
  "car",
  "truck",
  "bicycle",
  "package",
] as const;

export interface ParsedTargetIntent {
  rawPrompt: string;
  targetClasses: string[];
  attributes: string[];
  actionPolicy: "dataset_enroll" | "anpr_ocr" | "monitor" | "notify";
  /** True when the prompt asks to enroll sightings into the dataset. */
  datasetEnroll: boolean;
  /** True when the prompt asks for license-plate capture / ANPR. */
  anprEnabled: boolean;
  confidenceThreshold: number;
}

/**
 * Parse a tracking prompt into typed target filters.
 *
 * @example
 * const intent = parseNaturalLanguageIntent("track and register all dogs");
 * // → dog, dataset_enroll, breed+color attributes
 */
export function parseNaturalLanguageIntent(prompt: string): ParsedTargetIntent {
  const lower = prompt.toLowerCase();
  const classes = new Set<string>();
  const attributes = new Set<string>();
  let actionPolicy: ParsedTargetIntent["actionPolicy"] = "monitor";
  let datasetEnroll = false;
  let anprEnabled = false;

  if (/\b(dog|dogs|canine|canines)\b/.test(lower) || /\b(pet|pets)\b/.test(lower)) {
    classes.add("dog");
    attributes.add("breed");
    attributes.add("color");
  }
  if (/\b(cat|cats|feline|felines)\b/.test(lower)) {
    classes.add("cat");
    attributes.add("breed");
    attributes.add("color");
  }
  if (/\b(car|cars|vehicle|vehicles|auto|automobile)\b/.test(lower)) {
    classes.add("car");
    attributes.add("color");
    attributes.add("make");
  }
  if (/\b(truck|trucks)\b/.test(lower)) {
    classes.add("truck");
    attributes.add("color");
    attributes.add("make");
  }
  if (/\b(person|people|stranger|human|pedestrian)\b/.test(lower)) {
    classes.add("person");
    attributes.add("apparel");
  }
  if (/\b(bicycle|bike)\b/.test(lower)) {
    classes.add("bicycle");
  }
  if (/\b(bird|birds)\b/.test(lower)) {
    classes.add("bird");
  }
  if (/\b(package|parcel|delivery)\b/.test(lower)) {
    classes.add("package");
  }

  if (/\b(license|plate|licence|plates|number plate|anpr|ocr)\b/.test(lower)) {
    attributes.add("license_plate");
    anprEnabled = true;
    actionPolicy = "anpr_ocr";
  }
  if (/\b(register|enroll|dataset|record|log|collect|save|store)\b/.test(lower)) {
    datasetEnroll = true;
    if (actionPolicy !== "anpr_ocr") {
      actionPolicy = "dataset_enroll";
    }
  }
  if (/\b(notify|alert|warn|alarm)\b/.test(lower)) {
    actionPolicy = "notify";
  }

  // "track all dogs" without "register" still means watch that class;
  // enrollment is explicit. Tracking alone stays monitor unless notify/anpr.
  if (classes.size > 0 && actionPolicy === "monitor" && /\btrack\b/.test(lower)) {
    // keep monitor — watching without dataset enroll is valid
  }

  const targetClasses = Array.from(classes).filter((c) =>
    (KNOWN_CLASSES as readonly string[]).includes(c),
  );

  return {
    rawPrompt: prompt,
    targetClasses: targetClasses.length > 0 ? targetClasses : ["person"],
    attributes: Array.from(attributes),
    actionPolicy,
    datasetEnroll: datasetEnroll || actionPolicy === "dataset_enroll",
    anprEnabled,
    confidenceThreshold: 0.85,
  };
}
