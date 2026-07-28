/** Docs: installation and running. */
import { DocShell, DocSection } from "@/components/doc-shell";

function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">
      {children}
    </pre>
  );
}

export default function SetupDocs() {
  return (
    <DocShell
      title="Install and run"
      lede="One command sets up everything and starts the system. Here is what it actually does, so nothing about the install is a black box either."
    >
      <DocSection title="One-click setup">
        On Windows, double-click <code>Start-WatchingEye.bat</code> in the project folder. On
        macOS or Linux, run:
        <Cmd>./start.sh</Cmd>
        Either one checks your toolchain, installs anything missing, downloads the AI models,
        builds the Rust core, starts all three services, and opens the dashboard. Run it again
        any time — it skips work that is already done.
      </DocSection>

      <DocSection title="What gets installed">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Rust</strong> — the deterministic core: detection, tracking, validation.
          </li>
          <li>
            <strong>Node.js</strong> — the API gateway and this dashboard.
          </li>
          <li>
            <strong>Ollama</strong> plus <code>qwen2.5vl</code> (vision) and{" "}
            <code>llama3.2</code> (text), run locally. No image or transcript leaves your
            machine.
          </li>
          <li>
            <strong>YOLO11-nano</strong> for object detection and{" "}
            <strong>Whisper base.en</strong> for speech, stored under <code>models/</code>.
          </li>
        </ul>
        Skip the model downloads with <code>-SkipModels</code> (Windows) or{" "}
        <code>SKIP_MODELS=1</code> (macOS/Linux) if you only want the toolchain.
      </DocSection>

      <DocSection title="Running the parts by hand">
        Three processes make up the system. The launcher starts all of them; you can also run
        each on its own:
        <Cmd>{`cargo run -p vision-engine                     # detection core, port 8090
cd services/agent-orchestrator && npm run dev  # recognition,    port 8085
cd apps/gateway && npm run dev                 # API gateway,    port 8080
cd apps/dashboard && npm run dev               # this dashboard, port 3000`}</Cmd>
        The dashboard works without the engine — you simply will not get live camera tracking,
        and the Cameras page will tell you so rather than failing silently.
      </DocSection>

      <DocSection title="Connecting a camera">
        Open <strong>Cameras</strong>, click <strong>Scan for cameras</strong>, then{" "}
        <strong>Connect</strong>. Your browser asks for permission — the application cannot
        bypass that prompt, and no frame is captured until you allow it. Camera names stay hidden
        until permission is granted; that is the browser protecting you, not a bug.
      </DocSection>

      <DocSection title="Optional: history storage">
        Event history can be kept in Postgres. Without it the system runs entirely in memory and
        simply forgets on restart.
        <Cmd>docker compose up -d</Cmd>
      </DocSection>
    </DocShell>
  );
}
