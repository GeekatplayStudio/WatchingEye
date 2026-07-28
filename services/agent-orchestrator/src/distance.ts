/**
 * Monocular distance estimation — TypeScript mirror of the Rust
 * `crates/spatial/src/distance.rs`. The assumed heights, spreads, and the
 * pinhole formula must stay identical in both; change them together.
 *
 * Every estimate carries the assumption it was built on, because the model
 * has a known failure mode: a seated adult, a child, or a scale model reads
 * as further away or nearer than it is.
 */

/** A distance estimate and the assumption behind it. */
export interface DistanceEstimate {
  metres: number;
  minMetres: number;
  maxMetres: number;
  assumedHeightM: number;
  basis: string;
}

interface Assumption {
  heightM: number;
  spread: number;
  note: string;
}

/** Mirrors `assumption_for` in the Rust crate — keep in sync. */
const ASSUMPTIONS: Record<string, Assumption> = {
  person: {
    heightM: 1.7,
    spread: 0.25,
    note: "assuming a standing adult; a seated person or child reads as further away",
  },
  dog: { heightM: 0.55, spread: 0.45, note: "assuming a mid-sized dog; breeds vary enormously" },
  cat: { heightM: 0.3, spread: 0.3, note: "assuming an adult cat" },
  bird: { heightM: 0.25, spread: 0.6, note: "assuming a mid-sized bird; species vary hugely" },
  car: { heightM: 1.5, spread: 0.2, note: "assuming a passenger car" },
  truck: { heightM: 3.0, spread: 0.4, note: "assuming a delivery truck" },
  bicycle: { heightM: 1.1, spread: 0.25, note: "assuming a bicycle with no rider" },
  drone: {
    heightM: 0.3,
    spread: 0.7,
    note: "assuming a consumer quadcopter; size varies wildly and this is a weak estimate",
  },
  package: { heightM: 0.35, spread: 0.5, note: "assuming a parcel" },
};

/** Default vertical field of view assumed for a webcam, in degrees. */
const DEFAULT_VFOV_DEG = 50;

/** Focal length in pixels for a frame height and vertical field of view. */
export function focalLengthPx(frameHeight: number, verticalFovDeg = DEFAULT_VFOV_DEG): number {
  const clamped = Math.min(170, Math.max(5, verticalFovDeg));
  return frameHeight / 2 / Math.tan(((clamped / 2) * Math.PI) / 180);
}

/**
 * Estimate distance from apparent height in pixels.
 *
 * Returns `null` for unknown classes (no invented sizes) and for objects
 * too small on screen for the number to mean anything.
 */
export function estimateDistance(
  objectClass: string,
  apparentHeightPx: number,
  frameHeightPx: number,
): DistanceEstimate | null {
  const a = ASSUMPTIONS[objectClass.toLowerCase()];
  if (a === undefined) return null;
  if (!Number.isFinite(apparentHeightPx) || apparentHeightPx < 2) return null;
  if (!Number.isFinite(frameHeightPx) || frameHeightPx < 2) return null;

  const metres = (a.heightM * focalLengthPx(frameHeightPx)) / apparentHeightPx;
  if (!Number.isFinite(metres) || metres <= 0) return null;
  return {
    metres,
    minMetres: metres * (1 - a.spread),
    maxMetres: metres * (1 + a.spread),
    assumedHeightM: a.heightM,
    basis: a.note,
  };
}
