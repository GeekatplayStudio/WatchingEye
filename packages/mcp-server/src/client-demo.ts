#!/usr/bin/env node
/**
 * Client demo for the split MCP surfaces (ROADMAP 3.4).
 *
 * Calls the same gateway paths the Camera / Timeline / Alert tools use and
 * prints a short summary. No MCP transport — proves the observation contract
 * without an MCP host.
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:8080 npm run demo
 *   npm run demo -- --fixture   # offline fixture path (no gateway)
 */

import { selectAlerts, toAlertPolicy, type AlertEvent } from "./alerts.js";
import { createGatewayClient } from "./gateway.js";

const FIXTURE_CAMERAS = { cameras: [{ id: "webcam", kind: "webcam", location: "webcam" }] };
const FIXTURE_EVENTS = {
  events: [
    {
      id: "evt-alert",
      class: "person",
      filtered: false,
      cameraId: "webcam",
      timestamp: "2026-08-01T00:00:00Z",
    },
    {
      id: "evt-noise",
      class: "bird",
      filtered: true,
      cameraId: "webcam",
      timestamp: "2026-08-01T00:00:01Z",
    },
  ] satisfies AlertEvent[],
};
const FIXTURE_SETTINGS = {
  trackedClasses: ["person", "dog"],
  allowedActions: ["notify", "log_only"],
  policyMinConfidence: 0.95,
  activeIntent: null,
};

async function runFixture(): Promise<void> {
  const alerts = selectAlerts(FIXTURE_EVENTS.events);
  const policy = toAlertPolicy(FIXTURE_SETTINGS);
  console.log(
    JSON.stringify(
      {
        mode: "fixture",
        camera: { count: FIXTURE_CAMERAS.cameras.length, cameras: FIXTURE_CAMERAS.cameras },
        timeline: { recent: FIXTURE_EVENTS.events.length },
        alert: { count: alerts.length, alerts, policy },
      },
      null,
      2,
    ),
  );
}

async function runLive(base: string): Promise<void> {
  const get = createGatewayClient(base);
  const camerasBody = (await get("/api/cameras")) as { cameras?: unknown[] };
  const eventsBody = (await get("/api/events/recent?limit=20")) as { events?: AlertEvent[] };
  const settings = (await get("/api/settings")) as Record<string, unknown>;
  const health = await get("/health");
  const events = Array.isArray(eventsBody.events) ? eventsBody.events : [];
  const alerts = selectAlerts(events);
  console.log(
    JSON.stringify(
      {
        mode: "live",
        gateway: base,
        health,
        camera: { count: camerasBody.cameras?.length ?? 0 },
        timeline: { recent: events.length },
        alert: { count: alerts.length, policy: toAlertPolicy(settings) },
      },
      null,
      2,
    ),
  );
}

const fixture = process.argv.includes("--fixture");
if (fixture) {
  await runFixture();
} else {
  const base = process.env.GATEWAY_URL ?? "http://localhost:8080";
  try {
    await runLive(base);
  } catch (err) {
    console.error(`demo: gateway unreachable (${String(err)}); try: npm run demo -- --fixture`);
    process.exitCode = 1;
  }
}
