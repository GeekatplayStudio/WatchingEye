/**
 * Voice: Whisper STT → closed VoiceCommand parse (ROADMAP V.1).
 * Piper TTS / live two-way loop remain V.2.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VoiceCommandPanel } from "@/components/voice-command-panel";
import { Mic, Volume2 } from "lucide-react";

export default function VoicePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        eyebrow="WatchingEye · Voice module"
        title="Voice"
        lede="Local speech in → rule-parsed commands out. Transcripts are untrusted; unknown phrases are rejected, never guessed."
        actions={<Badge variant="success">V.1 STT + parse</Badge>}
      />
      <VoiceCommandPanel />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Speech Recognition (Whisper)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Upload audio or type a phrase. Orchestrator STT defaults to stub in CI
          (<code>WATCHINGEYE_WHISPER=stub</code>); with{" "}
          <code>whisper-cli</code> + <code>models/voice/ggml-base.en.bin</code> it
          uses the whisper.cpp CLI. Only closed intents (
          <code>show_camera</code>, <code>set_mode</code>, <code>query_events</code>,{" "}
          <code>status</code>) succeed.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-primary" /> Voice Response (Piper TTS)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Spoken replies (Piper) and the live two-way loop are still ROADMAP V.2.
          <code> renderSpeech</code> already templates validated facts only.
        </CardContent>
      </Card>
    </div>
  );
}
