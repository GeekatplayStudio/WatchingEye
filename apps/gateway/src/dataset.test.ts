/**
 * Pure helpers for the multimodal dataset (no Postgres required in CI).
 */
import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  DATASET_EMBED_DIM,
  DatasetStore,
  type DatasetRecord,
} from "./dataset.js";
import { parseVector, toVectorLiteral } from "./vector-db.js";

function unit(i: number): number[] {
  const v = new Array<number>(DATASET_EMBED_DIM).fill(0);
  v[i % DATASET_EMBED_DIM] = 1;
  return v;
}

function baseRecord(id: string, embedding?: number[]): DatasetRecord {
  const record: DatasetRecord = {
    id,
    objectId: `obj-${id}`,
    class: "person",
    cameraId: "cam-1",
    timestamp: new Date().toISOString(),
    confidence: 0.97,
    evidence: [{ label: "walking", description: "Subject walking" }],
    snapshotRef: `snap-${id}`,
    provenance: {
      model_version: "stub",
      prompt_version: "classify-v2-identity",
      input_images: [`snap-${id}`],
      timestamp: new Date().toISOString(),
    },
  };
  if (embedding !== undefined) {
    record.embedding = embedding;
    record.embedModel = "dinov2-vits14-onnx";
  }
  return record;
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity(unit(0), unit(0))).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal unit vectors", () => {
    expect(cosineSimilarity(unit(0), unit(1))).toBeCloseTo(0);
  });
});

describe("vector literals", () => {
  it("round-trips through the pgvector text form", () => {
    const v = [0.1, -0.2, 0.3];
    expect(toVectorLiteral(v)).toBe("[0.1,-0.2,0.3]");
    expect(parseVector(toVectorLiteral(v))).toEqual(v);
  });
});

describe("DatasetStore embeddings", () => {
  it("ranks nearest neighbours by cosine similarity", async () => {
    const store = new DatasetStore();
    await store.insertRecord(baseRecord("a", unit(0)));
    await store.insertRecord(baseRecord("b", unit(1)));
    await store.insertRecord(baseRecord("c")); // no vector

    const hits = await store.searchByEmbedding(unit(0), 5);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hits[0]?.id).toBe("a");
  });

  it("ranks CLIP neighbours separately from DINOv2", async () => {
    const store = new DatasetStore();
    const clipA = new Array<number>(512).fill(0);
    clipA[0] = 1;
    const clipB = new Array<number>(512).fill(0);
    clipB[1] = 1;
    const a = baseRecord("a", unit(0));
    a.clipEmbedding = clipA;
    const b = baseRecord("b", unit(1));
    b.clipEmbedding = clipB;
    await store.insertRecord(a);
    await store.insertRecord(b);
    const hits = await store.searchByClipEmbedding(clipA, 5);
    expect(hits[0]?.id).toBe("a");
  });

  it("ranks attr-bank neighbours separately from CLIP image", async () => {
    const store = new DatasetStore();
    const attrA = new Array<number>(512).fill(0);
    attrA[2] = 1;
    const attrB = new Array<number>(512).fill(0);
    attrB[3] = 1;
    const a = baseRecord("a", unit(0));
    a.attrEmbedding = attrA;
    const b = baseRecord("b", unit(1));
    b.attrEmbedding = attrB;
    await store.insertRecord(a);
    await store.insertRecord(b);
    const hits = await store.searchByAttrEmbedding(attrA, 5);
    expect(hits[0]?.id).toBe("a");
  });

  it("keeps keyword search working alongside vectors", async () => {
    const store = new DatasetStore();
    const plate = baseRecord("plate", unit(2));
    plate.licensePlate = "XYZ-9876";
    await store.insertRecord(plate);
    const hits = await store.search("XYZ-9876");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.embedding).toHaveLength(DATASET_EMBED_DIM);
    expect(await store.count()).toBe(1);
  });
});
