/** Docs: how a detection happens, stage by stage. */
import { DocShell, DocSection, Stage } from "@/components/doc-shell";

export default function PipelineDocs() {
  return (
    <DocShell
      title="How a detection happens"
      lede="A camera frame passes through seven stages before anything is reported. Each one can stop it, and each one records what it concluded."
    >
      <DocSection title="The stages">
        <Stage
          n={1}
          name="Frame validator"
          file="services/vision-engine/src/engine.rs"
          rejects="Frames whose sample count does not match their declared size."
        >
          The cheapest possible check, done first. A malformed or truncated frame never reaches
          the rest of the pipeline.
        </Stage>
        <Stage
          n={2}
          name="Background model"
          file="crates/motion/src/background.rs"
          rejects="Empty frames; frames whose size changed mid-stream."
        >
          The engine keeps a slowly-adapting picture of what the scene looks like when nothing
          is happening, then marks the samples that differ from it. This is what makes a moving
          object appear as one solid shape rather than a pair of thin edges.
          <em>
            {" "}
            Consequence worth knowing: something that stops moving is gradually absorbed into
            the background and stops being reported.
          </em>
        </Stage>
        <Stage
          n={3}
          name="Region extraction"
          file="crates/motion/src/blobs.rs"
          rejects="Regions smaller than the noise floor."
        >
          Adjacent changed samples are grouped into rectangles. Specks caused by sensor noise
          are discarded here rather than becoming phantom objects.
        </Stage>
        <Stage
          n={4}
          name="Tracking"
          file="crates/tracker/src/association.rs"
          rejects="Regions that overlap nothing and are not persistent enough to matter."
        >
          Each region is matched to an existing object by how much it overlaps, so an object
          keeps one identity as it moves. Two people standing near each other stay two objects.
        </Stage>
        <Stage
          n={5}
          name="Temporal validation"
          file="services/vision-engine/src/engine.rs"
          rejects="Anything that appears for only a frame or two."
        >
          A flicker is not an event. An object must be seen on several consecutive frames before
          it is taken seriously.
        </Stage>
        <Stage
          n={6}
          name="Trigger gate"
          file="crates/tracker/src/lib.rs"
          rejects="Everything that has not cleared confidence and persistence together."
        >
          This is the switch that decides whether the expensive AI stage runs at all. It opens
          once per object, not once per frame — which is why the system is not constantly
          querying a model.
        </Stage>
        <Stage
          n={7}
          name="Super Agent + guardrails"
          file="crates/guardrails/src/lib.rs"
          rejects="Any model output that fails schema, range, evidence, policy, or safety checks."
        >
          Only now does a vision model look at the snapshot. Whatever it returns is validated
          before it can become an alert. See the guardrails page.
        </Stage>
      </DocSection>

      <DocSection title="What you can verify yourself">
        Open the <strong>Cameras</strong> page and connect your webcam. The panel beside the
        video prints the actual trace for the frame on screen — the same strings the engine
        produced, not a re-creation. If a box appears, a stage put it there, and you can see
        which.
      </DocSection>
    </DocShell>
  );
}
