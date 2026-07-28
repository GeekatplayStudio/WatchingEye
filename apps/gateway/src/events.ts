/**
 * Event types mirrored from the Rust `schemas`/`events` crates, plus a
 * deterministic demo generator used until the vision engine connects.
 * The gateway never invents decisions — the demo generator is clearly
 * labeled and only active when no engine is attached.
 */

/** Object classes, mirroring `schemas::ObjectClass`. */
export type ObjectClass =
  | "person"
  | "dog"
  | "cat"
  | "car"
  | "truck"
  | "package"
  | "unknown";

/** A detection event as shown in the dashboard live feed. */
export interface DetectionEvent {
  id: string;
  objectId: string;
  class: ObjectClass;
  kind: "detected" | "entered_zone" | "exited_zone" | "lost";
  zone?: string;
  confidence: number;
  frames: number[];
  cameraId: string;
  timestamp: string;
  /** Evidence chain — zero-black-box requirement. */
  evidence: Array<{ label: string; description: string }>;
  /** Model + prompt provenance. */
  model: string;
  source: "engine" | "demo";
}

const DEMO_SCRIPT: Array<
  Pick<DetectionEvent, "class" | "kind" | "zone" | "confidence" | "cameraId" | "evidence">
> = [
  {
    class: "person",
    kind: "detected",
    confidence: 0.983,
    cameraId: "driveway",
    evidence: [
      { label: "walking", description: "Person walking toward front door" },
      { label: "blue_shirt", description: "Blue shirt, red backpack" },
    ],
  },
  {
    class: "dog",
    kind: "entered_zone",
    zone: "yard",
    confidence: 0.962,
    cameraId: "backyard",
    evidence: [{ label: "known_pet", description: "Matches known pet profile 'Mochi'" }],
  },
  {
    class: "car",
    kind: "entered_zone",
    zone: "driveway",
    confidence: 0.991,
    cameraId: "driveway",
    evidence: [{ label: "parked", description: "Vehicle slowing and parking" }],
  },
  {
    class: "package",
    kind: "detected",
    confidence: 0.955,
    cameraId: "porch",
    evidence: [{ label: "delivery", description: "Box placed near door" }],
  },
  {
    class: "person",
    kind: "exited_zone",
    zone: "driveway",
    confidence: 0.978,
    cameraId: "driveway",
    evidence: [{ label: "leaving", description: "Person walking away from house" }],
  },
];

let counter = 0;

/** Produce the next scripted demo event. Deterministic order, fresh ids. */
export function nextDemoEvent(): DetectionEvent {
  const base = DEMO_SCRIPT[counter % DEMO_SCRIPT.length];
  counter += 1;
  const frameStart = 40 + counter * 3;
  const event: DetectionEvent = {
    id: `evt-${Date.now()}-${counter}`,
    objectId: `obj-${(counter % 3) + 1}`,
    class: base?.class ?? "unknown",
    kind: base?.kind ?? "detected",
    confidence: base?.confidence ?? 0.9,
    frames: [frameStart, frameStart + 1, frameStart + 2],
    cameraId: base?.cameraId ?? "driveway",
    timestamp: new Date().toISOString(),
    evidence: base?.evidence ?? [],
    model: "demo-generator",
    source: "demo",
  };
  if (base?.zone !== undefined) {
    event.zone = base.zone;
  }
  return event;
}
