/** Docs: what "zero black box" concretely means. */
import { DocShell, DocSection } from "@/components/doc-shell";

export default function TransparencyDocs() {
  return (
    <DocShell
      title="What 'zero black box' means here"
      lede="Not a promise of good intentions — a set of records the system is structurally unable to skip."
    >
      <DocSection title="Every decision carries its own receipt">
        A decision that reaches you is required to carry: the evidence behind it, a confidence
        number, the frames it was drawn from, which camera saw it, which model version ran, which
        prompt version was used, the exact images that were fed in, and the timestamp. These are
        not optional fields that might be filled in — a decision missing them fails validation
        and never reaches you at all.
      </DocSection>

      <DocSection title="No free-form text carries meaning">
        Internally the system never passes prose between components. Risk is a number. Reasons
        are a list of labelled observations. This sounds pedantic until you notice that
        &ldquo;looks suspicious&rdquo; cannot be checked, compared, or argued with, while
        &ldquo;risk 0.82, because: running, near restricted area, after midnight&rdquo; can be.
      </DocSection>

      <DocSection title="The path is fixed">
        There is exactly one route from camera to alert. No stage is skipped when the system is
        busy, and no model chooses which stage runs next. Given the same input, you get the same
        output and the same path — which is what makes an incident reproducible days later.
      </DocSection>

      <DocSection title="Failures are visible, not swallowed">
        When a check rejects something, that rejection is itself recorded. A quiet system is not
        the same as a system with nothing to report, and you can tell the two apart.
      </DocSection>

      <DocSection title="What the system will not claim">
        It will not name an object it has not classified. Right now it tracks moving regions and
        assigns them stable identities; it does not yet say &ldquo;person&rdquo; or
        &ldquo;dog&rdquo;, and the interface says so rather than guessing. When classification is
        connected, the label will arrive with its evidence attached like everything else.
      </DocSection>
    </DocShell>
  );
}
