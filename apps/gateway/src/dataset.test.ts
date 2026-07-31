import { describe, expect, it } from "vitest";
import { DatasetStore, type DatasetRecord } from "./dataset.js";

describe("DatasetStore", () => {
  it("stores and searches dataset records by keyword", async () => {
    const store = new DatasetStore();
    const r1: DatasetRecord = {
      id: "ds-1",
      objectId: "obj-dog-1",
      class: "dog",
      cameraId: "cam-1",
      timestamp: new Date().toISOString(),
      breedOrModel: "Golden Retriever",
      confidence: 0.95,
      evidence: [{ label: "breed:golden_retriever", description: "Golden retriever dog" }],
      snapshotRef: "snap-1",
    };
    const r2: DatasetRecord = {
      id: "ds-2",
      objectId: "obj-car-1",
      class: "car",
      cameraId: "cam-1",
      timestamp: new Date().toISOString(),
      licensePlate: "ABC-1234",
      confidence: 0.98,
      evidence: [{ label: "plate:ABC-1234", description: "License plate ABC-1234" }],
      snapshotRef: "snap-2",
    };

    await store.insertRecord(r1);
    await store.insertRecord(r2);

    const dogResults = await store.search("golden");
    expect(dogResults).toHaveLength(1);
    expect(dogResults[0]?.objectId).toBe("obj-dog-1");

    const plateResults = await store.search("ABC-1234");
    expect(plateResults).toHaveLength(1);
    expect(plateResults[0]?.objectId).toBe("obj-car-1");
  });
});
