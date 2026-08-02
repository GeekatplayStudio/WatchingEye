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
  behaviors: string[];
  actionPolicy: "dataset_enroll" | "anpr_ocr" | "monitor" | "notify";
  /** True when the prompt asks to enroll sightings into the dataset. */
  datasetEnroll: boolean;
  /** True when the prompt asks for license-plate capture / ANPR. */
  anprEnabled: boolean;
  confidenceThreshold: number;
}

/**
 * Parse a tracking prompt into typed target filters and AI behavior triggers.
 *
 * @example
 * const intent = parseNaturalLanguageIntent("notify me if a person waves or pulls out a weapon");
 * // → person, behaviors: ["waving", "pulling_weapon"], actionPolicy: "notify"
 */
export function parseNaturalLanguageIntent(prompt: string): ParsedTargetIntent {
  const lower = prompt.toLowerCase();
  const classes = new Set<string>();
  const attributes = new Set<string>();
  const behaviors = new Set<string>();
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
  if (/\b(military|army|armored|tank|tactical)\b/.test(lower)) {
    classes.add("car");
    classes.add("truck");
    attributes.add("military_type");
    behaviors.add("military_vehicle");
  }
  if (/\b(truck|trucks)\b/.test(lower)) {
    classes.add("truck");
    attributes.add("color");
    attributes.add("make");
  }
  if (/\b(person|people|stranger|human|pedestrian|someone|individual)\b/.test(lower)) {
    classes.add("person");
    attributes.add("apparel");
  }
  if (/\b(glass|glasses|spectacles|sunglasses|eyewear|shades)\b/.test(lower)) {
    classes.add("person");
    attributes.add("wearing_glasses");
    attributes.add("eyewear");
  }
  if (/\b(take off|took off|removes|removing|takes off|remove glasses|took off glasses)\b/.test(lower)) {
    classes.add("person");
    attributes.add("eyewear_removed");
    behaviors.add("taking_off_glasses");
  }
  if (/\b(missing person|lost person|search and rescue|forest|woods|stranded)\b/.test(lower)) {
    classes.add("person");
    attributes.add("location_context");
    behaviors.add("missing_person");
  }
  if (/\b(wave|waved|waving|signal|signaling|sos|hand gesture)\b/.test(lower)) {
    classes.add("person");
    behaviors.add("waving");
  }
  if (/\b(crouch|crouched|crouching|sneak|sneaking|hide|hiding)\b/.test(lower)) {
    classes.add("person");
    behaviors.add("crouching");
  }
  if (/\b(loiter|loitering|linger|lingering|pacing|idle|idling)\b/.test(lower)) {
    classes.add("person");
    behaviors.add("loitering");
  }
  if (/\b(weapon|gun|firearm|pistol|rifle|knife|pull out|brandishing)\b/.test(lower)) {
    classes.add("person");
    attributes.add("weapon_type");
    behaviors.add("pulling_weapon");
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
  if (/\b(notify|alert|warn|alarm|send|message)\b/.test(lower)) {
    actionPolicy = "notify";
  }

  // Default confidence threshold adjusts based on threat/sensitivity level
  let confidenceThreshold = 0.85;
  if (behaviors.has("pulling_weapon") || behaviors.has("missing_person")) {
    confidenceThreshold = 0.75; // Lower threshold to prioritize high recall on critical alerts
  }

  const targetClasses = Array.from(classes).filter((c) =>
    (KNOWN_CLASSES as readonly string[]).includes(c),
  );

  return {
    rawPrompt: prompt,
    targetClasses: targetClasses.length > 0 ? targetClasses : ["person"],
    attributes: Array.from(attributes),
    behaviors: Array.from(behaviors),
    actionPolicy,
    datasetEnroll: datasetEnroll || actionPolicy === "dataset_enroll",
    anprEnabled,
    confidenceThreshold,
  };
}
