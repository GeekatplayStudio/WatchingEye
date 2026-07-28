/** Docs: the guardrail gates every model output must pass. */
import { DocShell, DocSection, Gate } from "@/components/doc-shell";

export default function GuardrailDocs() {
  return (
    <DocShell
      title="Why the AI is never trusted"
      lede="A vision model can be wrong, can be confidently wrong, and can be manipulated by what it sees. These gates assume all three."
    >
      <DocSection title="The gates, in order">
        <Gate n={1} name="Schema" catches="Prose, partial JSON, invented fields, wrong types.">
          The model is asked for a specific structure. If what comes back does not parse into
          that exact shape, it is discarded. A reply of &ldquo;Looks suspicious to me&rdquo;
          never becomes an alert, because it is not a decision — it is a sentence.
        </Gate>
        <Gate n={2} name="Range" catches="Confidence of 1.7, negative risk, and similar nonsense.">
          Numbers must lie inside their defined bounds. A model that reports 150% certainty is
          reporting a bug, not certainty.
        </Gate>
        <Gate n={3} name="Confidence floor" catches="Low-conviction guesses dressed up as findings.">
          Below the configured threshold, the decision is dropped rather than acted on. You can
          see and change this threshold on the Tuning page.
        </Gate>
        <Gate n={4} name="Evidence required" catches="Conclusions with nothing behind them.">
          A decision must list the specific observations that support it. No evidence, no
          decision — this is what makes every alert explainable after the fact.
        </Gate>
        <Gate n={5} name="Action allowlist" catches="Actions the system was never meant to take.">
          The model may only propose actions from a fixed list. If it asks to unlock a door and
          &ldquo;unlock&rdquo; is not on the list, the request is refused. Adding capabilities is
          a deliberate act by a person, not something a model can talk its way into.
        </Gate>
        <Gate n={6} name="Safety screening" catches="Prompt injection, fabricated evidence, unsupported alarm.">
          Text arriving from the model is scanned for instruction-like phrases — someone can
          hold a sign up to the camera reading &ldquo;ignore previous instructions&rdquo;, and
          the model may faithfully repeat it. That output is rejected. The screen also refuses
          duplicated evidence and high-risk claims backed by a single observation.
        </Gate>
        <Gate n={7} name="Classification lock" catches="A model overruling what the pipeline measured.">
          The deterministic stages already established what was detected. The model may describe
          it, but may not reclassify it. If the pipeline tracked one object and the model reports
          a weapon, that contradiction is treated as a failure, not a finding.
        </Gate>
      </DocSection>

      <DocSection title="What happens when a gate fails">
        The run stops. No action is taken, no alert is sent, and the failure is recorded with the
        reason and the raw output that caused it. Failing is a normal, logged outcome — not an
        error state to be retried until it passes. Nothing is ever retried with looser rules.
      </DocSection>

      <DocSection title="Where this lives">
        <code>crates/guardrails/src/lib.rs</code> and <code>crates/guardrails/src/safety.rs</code>{" "}
        in Rust, mirrored by <code>services/agent-orchestrator/src/schema.ts</code> for the
        service layer. Both are covered by tests that feed them hallucinated, malformed, and
        deliberately hostile input.
      </DocSection>
    </DocShell>
  );
}
