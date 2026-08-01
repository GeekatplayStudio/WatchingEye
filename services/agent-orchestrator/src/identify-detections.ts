/**
 * Attach Hungarian-assigned identities to YOLO detections.
 *
 * Embeds each box crop, then posts the whole set to `/api/identify/batch`
 * so two people in one frame cannot claim the same gallery slot. Failures
 * degrade to null identities — detection labels still return.
 */
import { embed, embedModelAvailable } from "./embed.js";
import { identifyBatch, type IdentificationOutcome } from "./identity.js";
import type { LabelledObject } from "./detect.js";

/** A detection optionally labelled with a registry verdict. */
export interface IdentifiedObject extends LabelledObject {
  identity: IdentificationOutcome | null;
}

/**
 * Embed each detection crop and run batch identity assignment.
 *
 * @example
 * const identified = await identifyDetections(jpeg, objects, "webcam");
 */
export async function identifyDetections(
  imageBase64: string,
  objects: LabelledObject[],
  cameraId: string,
): Promise<IdentifiedObject[]> {
  if (objects.length === 0) return [];
  if (!embedModelAvailable()) {
    return objects.map((o) => ({ ...o, identity: null }));
  }

  const appearances = await Promise.all(
    objects.map(async (obj) => {
      try {
        const result = await embed(imageBase64, obj.bbox);
        return result.embedding;
      } catch {
        return null;
      }
    }),
  );

  const outcomes = await identifyBatch(
    objects.map((obj, i) => ({
      class: obj.class,
      descriptors: [],
      cameraId,
      appearance: appearances[i],
    })),
  );

  return objects.map((obj, i) => ({
    ...obj,
    identity: outcomes[i] ?? null,
  }));
}
