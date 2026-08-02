/**
 * Voice: STT → parse, facts → TTS, PTT duplex, audio events, wake + continuous.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VoiceAskPanel } from "@/components/voice-ask-panel";
import { VoiceAudioEventPanel } from "@/components/voice-audio-event-panel";
import { VoiceCommandPanel } from "@/components/voice-command-panel";
import { VoiceLiveMicPanel } from "@/components/voice-live-mic-panel";
import { VoiceSpeakPanel } from "@/components/voice-speak-panel";
import { VoiceWakePanel } from "@/components/voice-wake-panel";
import { Mic, Volume2 } from "lucide-react";

export default function VoicePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        eyebrow="WatchingEye · Voice module"
        title="Voice"
        lede="Speech in is untrusted and rule-parsed. Speech out is templated from validated facts only — never free-form model text."
        actions={<Badge variant="success">V.1–V.4</Badge>}
      />
      <VoiceWakePanel />
      <VoiceLiveMicPanel />
      <VoiceAudioEventPanel />
      <VoiceAskPanel />
      <VoiceCommandPanel />
      <VoiceSpeakPanel />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Speech Recognition (Whisper)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <code>WATCHINGEYE_WHISPER=stub|auto|cli</code>. Push-to-talk uses the
          browser mic. Wake gate supports oneshot arm or continuous armed listen
          (tab must stay open) — not production always-on.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-primary" /> Voice Response (Piper TTS)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Stub beep or <code>piper</code> CLI when an ONNX voice is present.
          Background OS-level always-on listen is not claimed.
        </CardContent>
      </Card>
    </div>
  );
}
