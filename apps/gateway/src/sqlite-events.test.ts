/**
 * SQLite event store round-trip tests (no Postgres required).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, resolveEventsDbPath } from "./db.js";
import type { DetectionEvent } from "./events.js";
import { SqliteEventStore } from "./sqlite-events.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function sample(id: string): DetectionEvent {
  return {
    id,
    objectId: `obj-${id}`,
    class: "person",
    kind: "detected",
    confidence: 0.95,
    frames: [1, 2, 3],
    cameraId: "cam-1",
    timestamp: new Date().toISOString(),
    evidence: [{ label: "walk", description: "walking" }],
    model: "stub",
    promptVersion: "classify-v1",
    provenance: {
      model_version: "stub",
      prompt_version: "classify-v1",
      input_images: ["snap"],
      timestamp: new Date().toISOString(),
    },
    source: "engine",
  };
}

describe("SqliteEventStore", () => {
  it("round-trips insert, recent, and get across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "we-events-"));
    temps.push(dir);
    const path = join(dir, "events.sqlite");

    const a = SqliteEventStore.open(path);
    await a.insertEvent(sample("e1"));
    await a.insertEvent(sample("e2"));
    await a.close();

    const b = SqliteEventStore.open(path);
    const recent = await b.recentEvents(10);
    expect(recent.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect((await b.getEvent("e1"))?.objectId).toBe("obj-e1");
    expect(await b.getEvent("missing")).toBeNull();
    await b.close();
  });

  it("createStore uses SQLite when no DATABASE_URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "we-events-"));
    temps.push(dir);
    const path = join(dir, "events.sqlite");
    const store = await createStore(undefined, path);
    await store.insertEvent(sample("e3"));
    expect((await store.recentEvents(1))[0]?.id).toBe("e3");
    await store.close();
  });

  it("resolveEventsDbPath defaults to memory under Vitest", () => {
    expect(resolveEventsDbPath()).toBe("memory");
    expect(resolveEventsDbPath(":memory:")).toBe(":memory:");
  });
});
