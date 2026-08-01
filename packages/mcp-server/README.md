# WatchingEye MCP servers (ROADMAP 3.4)

Read-only observation over the gateway REST API (ADR 0003). MCP clients can
inspect cameras, timeline, and alerts — never actuate.

## Servers

| Bin | Domains | Tools |
|-----|---------|-------|
| `watchingeye-mcp` | all | camera + timeline + alert + `get_settings` |
| `watchingeye-mcp-camera` | camera | `list_cameras`, `gateway_health` |
| `watchingeye-mcp-timeline` | timeline | `recent_events`, `get_event` |
| `watchingeye-mcp-alert` | alert | `list_alerts`, `get_alert_policy` |

`list_alerts` is the recent-events feed with `filtered !== true` (presentation
filter only — nothing is deleted from the store).

## Run

```bash
export GATEWAY_URL=http://localhost:8080
npm start                 # combined
npm run start:camera
npm run start:timeline
npm run start:alert
```

## Client demo

Same gateway paths the tools use, without an MCP host:

```bash
npm run demo -- --fixture   # offline
GATEWAY_URL=http://localhost:8080 npm run demo
```

## Honest status

| Item | Status |
|------|--------|
| Combined read-only baseline | ✅ |
| Dedicated Camera / Timeline / Alert bins | ✅ |
| Client demo + vitest | ✅ |
| Write / actuation via MCP | disallowed (ADR 0003) |
