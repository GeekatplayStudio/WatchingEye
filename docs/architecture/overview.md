# Architecture Overview

```mermaid
flowchart TD
    C[Camera<br/>ESP32 / Pi / RTSP / USB] --> FB[Frame Buffer]
    FB --> FV[Frame Validator]
    FV --> MD[Motion Detection]
    MD --> OD[Object Detector<br/>trait Detector]
    OD --> CV[Confidence Validator]
    CV --> TV[Temporal Validator]
    TV --> TR[Tracker<br/>UUID + timeline]
    TR --> ODB[(Object Database<br/>SQLite / Postgres)]
    TR --> GATE{TriggerGate<br/>conf ≥ 0.95 AND<br/>3 consecutive frames}
    GATE -- closed --> ODB
    GATE -- open --> SA[Super Agent<br/>Rig + Ollama VLM]
    SA --> GR[Guardrails<br/>schema → range → confidence → policy]
    GR -- reject --> SAFE[Safe default + log]
    GR -- pass --> RE[Rule Engine<br/>IF/AND/THEN]
    RE --> ACT[Actions / Notifications]
    ACT --> GW[Node Gateway]
    GW --> UI[React Dashboard<br/>zero-black-box view]
```

## Crate dependency graph

`schemas` is the root; everything depends on it and nothing depends back:

```
schemas ← events ← rules
schemas ← guardrails
schemas ← camera ← detector
schemas ← tracker
all     ← services/vision-engine
```

## Where things go

- New camera backend → implement `camera::CameraSource` in `crates/camera/src/backends/`
- New vision model → implement `detector::Detector` in `crates/detector/src/backends/`
- New event type → `events::EventKind` variant + rule conditions
- New guardrail gate → add to `guardrails::validate` (order matters; document it)
- MCP servers wrap each crate at the service boundary (Phase 3)
