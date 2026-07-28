# ADR 0001 — Rust for the Deterministic Core

**Status:** Accepted · **Date:** 2026-07-27

## Context

The platform spans ESP32 firmware to GPU servers and must be deterministic,
fast (<100 ms detection latency), memory-safe, and auditable.

## Decision

All detection, tracking, validation, guardrail, and rule-engine logic is
written in Rust. Node.js is restricted to the API gateway; React to the UI.
No AI or decision logic exists outside Rust.

## Consequences

- One language covers embedded (`no_std`), edge, and server tiers.
- The type system enforces the guardrail schema (`serde` deserialization is
  the schema validation gate — invalid LLM output cannot become a value).
- Slower initial iteration than a scripting language; mitigated by stub
  backends behind stable traits (`CameraSource`, `Detector`).
