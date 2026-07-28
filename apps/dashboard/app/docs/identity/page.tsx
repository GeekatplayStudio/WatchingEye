/** Docs: identity, re-identification, and object memory. */
import { DocShell, DocSection } from "@/components/doc-shell";

export default function IdentityDocs() {
  return (
    <DocShell
      title="Identity: who, not just what"
      lede="Classification answers 'a dog'. Identity answers 'Mochi, seen four times this week'. They are separate on purpose, and only one of them involves a model."
    >
      <DocSection title="How it works">
        When a gated object is classified, the vision model is also asked to
        describe the features that would let someone recognise this individual again —
        fur colour, clothing, a licence plate, a collar. Those observations are called
        descriptors, and they are all the model contributes.
        <p>
          Deciding whether those descriptors belong to someone already known is done by
          arithmetic in <code>crates/identity</code>, not by asking the model &ldquo;is this
          the same dog?&rdquo; That question has to be answerable identically tomorrow, from
          a log, by someone who does not trust either of us.
        </p>
      </DocSection>

      <DocSection title="Not all features count the same">
        A licence plate identifies a car. &ldquo;Medium sized&rdquo; barely narrows anything.
        The system weights attributes accordingly, in fixed code:
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Distinctive</strong> — licence plate, visible text, a unique marking. A
            match confirms; a mismatch <em>refutes outright</em>, whatever else agrees.
          </li>
          <li>
            <strong>Supporting</strong> — fur colour, clothing, breed, vehicle make. Meaningful
            together, insufficient alone.
          </li>
          <li>
            <strong>Weak</strong> — size, and anything the system does not recognise. A model
            cannot mint confidence by inventing an impressive-sounding attribute name.
          </li>
        </ul>
      </DocSection>

      <DocSection title="Two rules that prevent the obvious mistakes">
        <p>
          <strong>A missing attribute is not a difference.</strong> If a previous sighting
          recorded a breed and this one did not, that is absence of evidence, and it counts
          neither for nor against.
        </p>
        <p>
          <strong>A distinctive conflict ends the argument.</strong> Same make, same model,
          same colour, different plate: that is a different car, and no amount of other
          agreement overrides it.
        </p>
        <p>
          <strong>Identities never cross classes.</strong> A brown dog is never matched against
          a brown car, however neatly the attributes line up.
        </p>
      </DocSection>

      <DocSection title="What you are told">
        Every identification carries its score, exactly which attributes agreed, which
        conflicted, and which candidates were rejected and why. When the system says
        &ldquo;Mochi, seen 4 times&rdquo;, you can ask what convinced it and get an answer
        like <em>matched: breed, fur colour</em> — and disagree with it.
      </DocSection>

      <DocSection title="Object memory">
        Each identity keeps a timeline: when it was seen, on which camera, and what matched
        that time. That history is what makes questions like &ldquo;who was at the door
        today?&rdquo; answerable from records rather than from a model&apos;s recollection.
      </DocSection>

      <DocSection title="Honest limits">
        Identity here is only as good as the descriptors a vision model reports, and models
        describe clothing far better than faces. Two people in similar jackets can merge;
        the same person in a different coat can split into two identities. There is no face
        recognition and no biometric matching — deliberately. Treat identity as a strong hint
        backed by stated evidence, not as proof of who someone is.
      </DocSection>
    </DocShell>
  );
}
