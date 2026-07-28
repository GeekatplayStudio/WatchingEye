/**
 * Docs index — the zero-black-box explanation of how the system decides.
 * Written for an operator, not a developer: every claim here corresponds to
 * code you can open, and each page names the file that implements it.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, GitBranch, Eye, Mic, Boxes, Fingerprint } from "lucide-react";

const PAGES = [
  {
    href: "/docs/pipeline",
    icon: GitBranch,
    title: "How a detection happens",
    blurb: "Every stage between a camera frame and an alert, and what each one can reject.",
  },
  {
    href: "/docs/guardrails",
    icon: ShieldCheck,
    title: "Why the AI is never trusted",
    blurb: "The seven gates every model output must pass, and what each one catches.",
  },
  {
    href: "/docs/identity",
    icon: Fingerprint,
    title: "Identity: who, not just what",
    blurb: "How the system recognises the same individual again — and why a model never decides that.",
  },
  {
    href: "/docs/transparency",
    icon: Eye,
    title: "What 'zero black box' means here",
    blurb: "The record kept for every decision, and how to audit one after the fact.",
  },
  {
    href: "/docs/voice",
    icon: Mic,
    title: "Voice: listening and answering",
    blurb: "How spoken commands are parsed without letting a model decide what you meant.",
  },
  {
    href: "/docs/setup",
    icon: Boxes,
    title: "Install and run",
    blurb: "One-click setup, what gets installed, and how to start each part by hand.",
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
        <p className="mt-2 text-muted-foreground">
          This system is built so that nothing about a decision is hidden from you. These pages
          explain exactly how it reaches its conclusions — including what it cannot do.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The one rule everything follows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">An AI model is never trusted.</strong> Model
            output is treated as untrusted data — the same way a web form&apos;s contents are
            treated. It is parsed, range-checked, screened, and policy-checked before anything
            acts on it. If any check fails, the system does nothing and records why.
          </p>
          <p>
            Nothing in the pipeline branches on what a model &ldquo;decided&rdquo;. Routing is
            done by ordinary code reading validated fields.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {PAGES.map(({ href, icon: Icon, title, blurb }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{blurb}</CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current honest status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <Badge variant="success">working</Badge> Motion detection, region extraction, object
            tracking with stable identities, and the trigger gate — all running in Rust, live,
            on your webcam via the <Link href="/cameras" className="text-primary">Cameras</Link>{" "}
            page.
          </p>
          <p>
            <Badge variant="success">working</Badge> Object recognition. When the gate opens, the
            snapshot goes to a vision model running locally through Ollama, and the answer must
            pass every guardrail before it appears. Typical round trip is 5–11 seconds, which is
            affordable precisely because it happens once per object rather than once per frame.
          </p>
          <p>
            <Badge variant="warning">honest limit</Badge> Recognition refuses more often than it
            answers, on purpose. A model that reports 80% certainty is below the floor and is
            discarded rather than shown to you. If you see &ldquo;refused by guardrails&rdquo;,
            the system is working — it means nothing trustworthy could be concluded.
          </p>
          <p>
            <Badge variant="success">working</Badge> Naming stationary objects. A YOLO detector
            runs on the full snapshot every second or so, independent of motion — a parked car or
            a seated person gets a label, a confidence, and a rough distance with its assumption
            stated. Unchecked classes are dimmed, never hidden.
          </p>
          <p>
            <Badge variant="warning">honest limit</Badge> The detector&apos;s vocabulary is COCO&apos;s
            80 classes — it cannot name a drone (the VLM path can). Distance is estimated from
            typical object sizes, not measured; a true depth map needs a depth model that is not
            yet wired. The audio path for voice is also not yet attached.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
