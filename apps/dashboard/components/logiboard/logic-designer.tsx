"use client";

import React, { useState, useRef } from "react";
import {
  GitBranch,
  Play,
  Copy,
  Download,
  Upload,
  FileCode,
  Sparkles,
  Terminal,
  Zap,
  HardDrive,
  Cpu,
  GripVertical,
} from "lucide-react";
import { LogiBoardSidebar } from "./sidebar";
import { LogiBoardCanvas } from "./canvas";
import { NodeConfigPanel } from "./node-config-panel";
import { useNodeEditorStore } from "./use-node-editor-store";
import { TargetLanguage, generateCodeFromGraph, FlowNode, FlowEdge } from "@/lib/logiboard/multi-lang-generator";
import { runFlowSimulation, SimulationInputs, SimulationResult } from "@/lib/logiboard/flow-simulator";

export function LogiBoardDesigner() {
  const nodes = useNodeEditorStore((state) => state.nodes);
  const edges = useNodeEditorStore((state) => state.edges);
  const runScenario = useNodeEditorStore((state) => state.runScenario);
  const flowSpeedMs = useNodeEditorStore((state) => state.flowSpeedMs);
  const setFlowSpeedMs = useNodeEditorStore((state) => state.setFlowSpeedMs);

  const [activeLang, setActiveLang] = useState<TargetLanguage>("cpp");
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);

  // Resizable Panel Widths
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [codeWidth, setCodeWidth] = useState(340);
  const isResizingSidebar = useRef(false);
  const isResizingCode = useRef(false);

  // Firmware options
  const [boardModel, setBoardModel] = useState("freenove_esp32_s3");
  const [wifiSsid, setWifiSsid] = useState("WatchingEye_Mesh");
  const [wifiPass, setWifiPass] = useState("securepass123");
  const [sdRecord, setSdRecord] = useState(true);

  // Simulation test inputs
  const [simInputs, setSimInputs] = useState<SimulationInputs>({
    targetClass: "cat",
    confidence: 0.88,
    behavior: "none",
    motionDetected: true,
    simulatedFrameWidth: 640,
    simulatedFrameHeight: 480,
  });

  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Convert Zustand nodes & edges into FlowNode[] and FlowEdge[] for generator & simulator
  const flowNodes: FlowNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.type || "customCode",
    data: {
      label: n.data.label,
      targetClass: n.data.targetClass as string,
      behavior: n.data.behavior as string,
      confidence: n.data.confidence as number,
      customCode: n.data.customCode as string,
      webhookUrl: n.data.webhookUrl as string,
    },
  }));

  const flowEdges: FlowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));

  const generatedCode = generateCodeFromGraph(flowNodes, flowEdges, activeLang);

  // Drag resizers
  const handleMouseDownSidebar = () => {
    isResizingSidebar.current = true;
    const onMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar.current) {
        setSidebarWidth(Math.max(180, Math.min(400, e.clientX)));
      }
    };
    const onMouseUp = () => {
      isResizingSidebar.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleMouseDownCode = () => {
    isResizingCode.current = true;
    const onMouseMove = (e: MouseEvent) => {
      if (isResizingCode.current) {
        setCodeWidth(Math.max(240, Math.min(600, window.innerWidth - e.clientX)));
      }
    };
    const onMouseUp = () => {
      isResizingCode.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleRunSimulation = async () => {
    const result = runFlowSimulation(flowNodes, flowEdges, simInputs);
    setSimResult(result);
    await runScenario();
    setStatusMsg(
      result.passed
        ? "Simulation PASSED! Flow conditions satisfied."
        : "Simulation FAILED. Test inputs did not satisfy criteria.",
    );
  };

  const handleSaveFirmwareOptions = () => {
    const blob = new Blob([generatedCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esp32_s3_firmware.${activeLang === "cpp" ? "ino" : "cpp"}`;
    a.click();
    setShowFirmwareModal(false);
    setStatusMsg("Firmware package & node logic flow options saved successfully!");
  };

  return (
    <div className="flex h-full w-full flex-col font-mono bg-background select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3 shrink-0">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-bold tracking-wider text-foreground uppercase">
            <GitBranch className="h-4 w-4 text-amber-500" />
            LogiBoard Resizable Node Workspace & Firmware Studio
          </h1>
          <p className="text-[0.65rem] text-muted-foreground">
            Interactive Node Canvas • Resizable Panels • ESP32-S3 Firmware Exporter
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFirmwareModal(true)}
            className="flex items-center gap-1.5 rounded bg-sky-600/20 border border-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-600/30 transition-all"
          >
            <Cpu className="h-3.5 w-3.5" /> Save Firmware Options
          </button>
          <button
            onClick={handleRunSimulation}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-all"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Run Scenario Test
          </button>
          <button
            onClick={() => setShowFirmwareModal(true)}
            className="flex items-center gap-2 rounded bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-all"
          >
            <Upload className="h-3.5 w-3.5" /> Upload to ESP32
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-300">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Main Workspace Body: Sidebar + Resizer + Canvas + Inspector + Resizer + Code Panel */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Drag-and-Drop Node Library Sidebar */}
        <div style={{ width: sidebarWidth }} className="shrink-0 flex">
          <LogiBoardSidebar />
        </div>

        {/* Sidebar Drag Resizer */}
        <div
          onMouseDown={handleMouseDownSidebar}
          className="w-1.5 cursor-col-resize hover:bg-amber-500/50 bg-border/40 transition-colors flex items-center justify-center"
        >
          <GripVertical className="h-4 w-3 text-muted-foreground/40" />
        </div>

        {/* Center: Connectable `@xyflow/react` Node Canvas */}
        <div className="flex-1 h-full relative min-w-0">
          <LogiBoardCanvas />
        </div>

        {/* Node Parameter Inspector Panel */}
        <NodeConfigPanel />

        {/* Code Panel Drag Resizer */}
        <div
          onMouseDown={handleMouseDownCode}
          className="w-1.5 cursor-col-resize hover:bg-amber-500/50 bg-border/40 transition-colors flex items-center justify-center"
        >
          <GripVertical className="h-4 w-3 text-muted-foreground/40" />
        </div>

        {/* Right: Simulator Tester & Live Generated Code Exporter */}
        <div style={{ width: codeWidth }} className="shrink-0 flex flex-col border-l border-border bg-card p-4 gap-4 overflow-y-auto font-mono">
          {/* Simulator Inputs & Test Runner */}
          <div className="flex flex-col gap-3 rounded border border-border bg-background p-3.5">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-emerald-400" /> Scenario Input Simulator
            </span>

            <div className="flex flex-col gap-1 text-xs">
              <label className="text-[0.65rem] uppercase text-muted-foreground font-semibold">Test Natural Language Trigger Condition</label>
              <input
                type="text"
                value={simInputs.targetClass}
                onChange={(e) => setSimInputs({ ...simInputs, targetClass: e.target.value })}
                placeholder="e.g. 'person waving', 'weapon drawn', 'military vehicle', 'cat in yard'"
                className="w-full rounded border border-border bg-card p-2 text-xs text-amber-300 font-mono focus:outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div>
              <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
                <span>Confidence Score</span>
                <span className="text-amber-400">{Math.round(simInputs.confidence * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.40"
                max="0.99"
                step="0.01"
                value={simInputs.confidence}
                onChange={(e) => setSimInputs({ ...simInputs, confidence: parseFloat(e.target.value) })}
                className="mt-1 w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
                <span>Data Flow Execution Speed</span>
                <span className="text-sky-400">{flowSpeedMs}ms / node</span>
              </div>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={flowSpeedMs}
                onChange={(e) => setFlowSpeedMs(parseInt(e.target.value))}
                className="mt-1 w-full accent-sky-500"
              />
            </div>

            {/* Test Log Output */}
            {simResult && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <span className="text-[0.65rem] uppercase text-muted-foreground flex items-center gap-1">
                  <Terminal className="h-3 w-3 text-sky-400" /> Execution Trace
                </span>
                <div className="max-h-28 overflow-y-auto rounded bg-zinc-950 p-2 text-[0.65rem] text-sky-300">
                  {simResult.logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Generated Code Output Panel */}
          <div className="flex flex-col gap-2 rounded border border-border bg-background p-3.5 flex-1 min-h-[220px]">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <FileCode className="h-4 w-4 text-purple-400" /> Code Output
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => navigator.clipboard.writeText(generatedCode)}
                  className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[0.65rem] text-foreground hover:bg-muted/80"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([generatedCode], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `logic_flow.${activeLang === "cpp" ? "ino" : activeLang === "rust" ? "rs" : activeLang === "python" ? "py" : activeLang === "json_ash" ? "json" : "ts"}`;
                    a.click();
                  }}
                  className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[0.65rem] text-foreground hover:bg-muted/80"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </div>
            </div>

            {/* Target Language Tabs */}
            <div className="flex gap-1 border-b border-border/60 pb-2 text-[0.65rem] flex-wrap">
              {(["cpp", "rust", "typescript", "python", "json_ash"] as TargetLanguage[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`rounded px-2 py-0.5 uppercase font-semibold transition-all ${
                    activeLang === lang
                      ? "bg-amber-500 text-black"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "json_ash" ? "ASH-JSON" : lang}
                </button>
              ))}
            </div>

            <pre className="flex-1 overflow-y-auto rounded bg-zinc-950 p-2.5 text-[0.65rem] text-emerald-400 border border-zinc-800">
              {generatedCode}
            </pre>
          </div>
        </div>
      </div>

      {/* Firmware Options Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl flex flex-col gap-4 font-mono">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <Cpu className="h-5 w-5 text-amber-500" />
              Save Firmware Options & Package
            </h2>

            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="text-[0.65rem] uppercase text-muted-foreground">Target Hardware Board</label>
                <select
                  value={boardModel}
                  onChange={(e) => setBoardModel(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                >
                  <option value="freenove_esp32_s3">Freenove ESP32-S3 CAM (16MB Flash, 8MB PSRAM)</option>
                  <option value="ai_thinker_esp32_cam">AI-Thinker ESP32-CAM (4MB Flash)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.65rem] uppercase text-muted-foreground">Wi-Fi SSID</label>
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                  />
                </div>
                <div>
                  <label className="text-[0.65rem] uppercase text-muted-foreground">Wi-Fi Password</label>
                  <input
                    type="password"
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <input
                  type="checkbox"
                  id="sd_rec"
                  checked={sdRecord}
                  onChange={(e) => setSdRecord(e.target.checked)}
                  className="h-4 w-4 rounded accent-amber-500"
                />
                <label htmlFor="sd_rec" className="text-xs text-foreground flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-emerald-400" />
                  Enable MicroSD Card Event Video Storage (/sdcard/events/)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button
                onClick={() => setShowFirmwareModal(false)}
                className="rounded bg-muted px-4 py-2 text-xs text-foreground hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFirmwareOptions}
                className="rounded bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
              >
                Save & Download Firmware Package
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
