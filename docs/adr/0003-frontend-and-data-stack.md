# ADR 0003 — Next.js Frontend, Postgres/pgvector, LangGraph-in-TS, MCP

**Status:** Accepted · **Date:** 2026-07-27

## Context

Phase 2 needs a production-grade monitoring UI, persistent storage, agent
orchestration, and external tool access. The original scaffold used Vite +
React and SQLite-first storage.

## Decisions

1. **Frontend: Next.js 15 + Tailwind 4 + shadcn-style components** (plus
   TanStack Query, lucide-react, CVA). Replaces the Vite scaffold. Real-time
   data over a WebSocket to the gateway; REST proxied via Next rewrites.
2. **Database: Postgres with pgvector** (docker-compose) as the primary
   server-tier store. Events land in JSONB now; pgvector hosts RAG
   embeddings later. SQLite remains the edge-tier store (Pi, offline).
3. **Super Agent orchestration: LangGraph (TypeScript)** in
   `services/agent-orchestrator`. Constraints from ADR 0002 hold: the graph
   is a DAG, the only conditional edges are deterministic zod-validation
   pass/fail checks, and models are leaf calls behind an injectable
   `Analyzer` interface. The Rust `guardrails` crate stays authoritative for
   engine-side validation; zod mirrors the same schema at the service layer.
4. **MCP: read-only observation server** in `packages/mcp-server` exposing
   cameras/events/settings. Write access (actuation) via MCP is disallowed
   until a policy engine for it exists.

## Consequences

- Two guardrail implementations (serde + zod) must stay schema-identical;
  a shared JSON Schema export is the planned enforcement (Phase 3).
- Node service layer grows, but AI decision-making stays in validated,
  deterministic paths — LangGraph orchestrates, code decides.
