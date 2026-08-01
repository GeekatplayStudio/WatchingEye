import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { ingestEdgeSync, toDetectionEvent } from "./edge-sync.js";
import { MemoryEventStore } from "./db.js";

describe("edge-sync", () => {
  it("maps gate-open metadata without inventing a class", () => {
    const ev = toDetectionEvent({
      id: "edge-1-10-3",
      cameraId: "edge-1",
      frame: 10,
      trackId: 3,
      kind: "gate_open",
      createdAt: "2026-08-01T00:00:00Z",
      payload: { seen_frames: 3, bbox: { x: 1, y: 2, width: 3, height: 4 } },
    });
    expect(ev.model).toBe("edge-cache");
    expect(ev.class).toBe("unknown");
    expect(ev.source).toBe("engine");
    expect(ev.frames).toEqual([10]);
    expect(ev.evidence.some((e) => e.label === "edge:gate_open")).toBe(true);
  });

  it("idempotently inserts and ACK's the same id twice", async () => {
    const store = new MemoryEventStore();
    const body = {
      nodeId: "edge-1",
      events: [
        {
          id: "edge-1-1-2",
          cameraId: "edge-1",
          frame: 1,
          trackId: 2,
          kind: "gate_open",
          createdAt: "t",
          payload: { seen_frames: 3 },
        },
      ],
    };
    const a = await ingestEdgeSync(store, body);
    const b = await ingestEdgeSync(store, body);
    expect(a.accepted).toEqual(["edge-1-1-2"]);
    expect(b.accepted).toEqual(["edge-1-1-2"]);
    const recent = await store.recentEvents(10);
    expect(recent).toHaveLength(1);
  });

  it("POST /api/edge/sync stores a feed event", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/edge/sync",
      payload: {
        nodeId: "edge-1",
        events: [
          {
            id: "edge-1-42-7",
            cameraId: "edge-1",
            frame: 42,
            trackId: 7,
            kind: "gate_open",
            createdAt: "2026-08-01T12:00:00Z",
            payload: { seen_frames: 3 },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toEqual(["edge-1-42-7"]);
    const feed = await app.inject({ method: "GET", url: "/api/events/recent" });
    expect(feed.json().events[0].id).toBe("edge-1-42-7");
    expect(feed.json().events[0].model).toBe("edge-cache");
    const cams = await app.inject({ method: "GET", url: "/api/cameras" });
    expect(cams.json().cameras[0].id).toBe("edge-1");
    await app.close();
  });
});
