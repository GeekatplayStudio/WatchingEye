/**
 * The Super Agent DAG, built with LangGraph — used strictly for
 * orchestration, never for routing decisions (ADR 0002).
 *
 * validate_input → analyze (VLM, injectable) → guardrail → route_action → END
 *
 * The only conditional edge is `guardrail`'s pass/fail, decided by zod
 * parsing — deterministic code, not a model. Failure ends the run with a
 * safe default. There are no cycles.
 */
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import { AgentDecisionSchema, TriggerEventSchema, type TriggerEvent } from "./schema.js";
import { screen, ScreenError, type Policy } from "./screen.js";

/** VLM adapter: takes a validated trigger, returns raw (untrusted) output. */
export type Analyzer = (event: TriggerEvent) => Promise<string>;

/** Full state carried through the graph — everything is logged. */
const AgentState = Annotation.Root({
  rawEvent: Annotation<unknown>,
  event: Annotation<TriggerEvent | null>({ reducer: (_, b) => b, default: () => null }),
  rawAnalysis: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  decision: Annotation<unknown>({ reducer: (_, b) => b, default: () => null }),
  outcome: Annotation<"pending" | "action" | "safe_default">({
    reducer: (_, b) => b,
    default: () => "pending" as const,
  }),
  rejectionReason: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
});

type State = typeof AgentState.State;

/**
 * Build the compiled Super Agent graph with an injected analyzer.
 *
 * `policy` overrides the default confidence floor and action allowlist.
 */
export function buildAgentGraph(analyze: Analyzer, policy?: Policy) {
  const graph = new StateGraph(AgentState)
    .addNode("validate_input", (state: State) => {
      const parsed = TriggerEventSchema.safeParse(state.rawEvent);
      if (!parsed.success) {
        return { outcome: "safe_default" as const, rejectionReason: parsed.error.message };
      }
      return { event: parsed.data };
    })
    .addNode("analyze", async (state: State) => {
      if (state.event === null) {
        return { outcome: "safe_default" as const };
      }
      return { rawAnalysis: await analyze(state.event) };
    })
    .addNode("guardrail", (state: State) => {
      let json: unknown;
      try {
        json = JSON.parse(state.rawAnalysis);
      } catch {
        return { outcome: "safe_default" as const, rejectionReason: "not valid JSON" };
      }
      const parsed = AgentDecisionSchema.safeParse(json);
      if (!parsed.success) {
        return { outcome: "safe_default" as const, rejectionReason: parsed.error.message };
      }
      // Schema shape is not enough: apply the policy and safety gates too.
      try {
        const screened = screen(parsed.data, state.event?.class ?? "", policy);
        return { decision: screened };
      } catch (err) {
        return {
          outcome: "safe_default" as const,
          rejectionReason:
            err instanceof ScreenError
              ? `${err.gate}: ${err.message}`
              : "screening failed",
        };
      }
    })
    .addNode("route_action", () => ({ outcome: "action" as const }))
    .addEdge(START, "validate_input")
    .addConditionalEdges("validate_input", (state: State) =>
      state.outcome === "safe_default" ? END : "analyze",
    )
    .addEdge("analyze", "guardrail")
    .addConditionalEdges("guardrail", (state: State) =>
      state.outcome === "safe_default" ? END : "route_action",
    )
    .addEdge("route_action", END);

  return graph.compile();
}
