# ADR 0002 — Orchestration Is Deterministic; LLMs Never Route

**Status:** Accepted · **Date:** 2026-07-27

## Context

Agent frameworks (LangGraph, Rig) allow LLM-driven routing and autonomous
loops. The PRD forbids both: zero black box, no cycles, no autonomous
planning.

## Decision

- Graph transitions are predeclared in code/config and validated at startup.
  The graph is a DAG: Vision → Validation → Tracking → Memory → Context →
  LLM → Validator → Rules → Actions.
- LLM/VLM calls are leaf operations that return structured JSON only.
  Routing decisions are made by the Rust rule engine on validated fields,
  never by model output directly.
- The Super Agent runs only when `tracker::TriggerGate` opens (confidence +
  consecutive-frames + motion gates), never continuously.
- Every model call records model version, prompt version, inputs, outputs,
  timestamp (`schemas::Provenance`).

## Consequences

- Replay and audit are trivial: same inputs, same path, same outputs.
- Some agent flexibility is lost by design; new behaviors require adding
  declared graph nodes and rules, which is the point.
