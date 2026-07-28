/**
 * Voice: placeholder for the two-way voice module (recognize + talk back).
 * STT: Whisper (model already provisioned by scripts/install-models).
 * TTS: Piper (local neural voices). See ROADMAP "Voice Module".
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Volume2 } from "lucide-react";

export default function VoicePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Voice</h1>
        <Badge variant="warning">planned — see roadmap</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Speech Recognition (Whisper)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Spoken commands (&quot;show the driveway&quot;, &quot;arm night mode&quot;) transcribed
          locally with Whisper, parsed into structured commands, and validated by the same
          guardrail pipeline as vision events. The model
          (<code>models/voice/ggml-base.en.bin</code>) is installed by
          <code> scripts/install-models</code>.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-primary" /> Voice Response (Piper TTS)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The system talks back: spoken alerts (&quot;person at the front door&quot;) and
          command confirmations, generated locally with Piper. Every spoken response is the
          rendering of a validated, logged decision — never free-form model output.
        </CardContent>
      </Card>
    </div>
  );
}
