/**
 * Pipeline: static visualization of the deterministic detection DAG.
 * Will become interactive (React Flow) when the engine reports per-stage
 * telemetry; the stage order shown here is the only order that exists.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown } from "lucide-react";

const STAGES: Array<{ name: string; detail: string; owner: string }> = [
  { name: "Camera", detail: "ESP32 / Pi / RTSP / USB capture", owner: "crates/camera" },
  { name: "Motion Detection", detail: "Frame differencing, no ML", owner: "vision-engine" },
  { name: "Object Detector", detail: "YOLO11 via ONNX Runtime", owner: "crates/detector" },
  { name: "Confidence Validator", detail: "Threshold filter (tunable)", owner: "crates/detector" },
  { name: "Temporal Validator", detail: "Consecutive-frame check", owner: "crates/tracker" },
  { name: "Tracker", detail: "Stable UUID + timeline", owner: "crates/tracker" },
  { name: "Trigger Gate", detail: "conf ≥ threshold AND N frames", owner: "crates/tracker" },
  { name: "Super Agent", detail: "VLM scene analysis (event-driven only)", owner: "LangGraph DAG" },
  { name: "Guardrails", detail: "schema → range → confidence → policy", owner: "crates/guardrails" },
  { name: "Rule Engine", detail: "Declarative IF/AND/THEN", owner: "crates/rules" },
  { name: "Actions", detail: "Notify / log — allowlisted only", owner: "gateway" },
];

export default function PipelinePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
      <p className="text-sm text-muted-foreground">
        The complete decision path. There are no other paths — no cycles, no autonomous
        loops, no LLM-driven routing.
      </p>
      <div className="flex flex-col items-stretch">
        {STAGES.map((stage, i) => (
          <div key={stage.name}>
            {i > 0 && (
              <div className="flex justify-center py-1">
                <ArrowDown className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <Card>
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle>{stage.name}</CardTitle>
                  <Badge variant="outline">{stage.owner}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-1 text-sm text-muted-foreground">
                {stage.detail}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
