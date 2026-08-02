import React from "react";
import { Camera, ShieldCheck, Code2, Radio, Plus, Layers, Play, GitBranch, Binary, Sliders, Dices } from "lucide-react";
import { useNodeEditorStore } from "./use-node-editor-store";

export function LogiBoardSidebar() {
  const addNode = useNodeEditorStore((state) => state.addNode);
  const runScenario = useNodeEditorStore((state) => state.runScenario);
  const randomizeInputs = useNodeEditorStore((state) => state.randomizeInputs);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const CATEGORIES = [
    {
      name: "Inputs",
      nodes: [
        { type: "cameraInput", label: "ESP32 Camera Feed", icon: Camera, color: "text-sky-400" },
        { type: "triggerInput", label: "Manual Trigger", icon: Play, color: "text-amber-400" },
        { type: "constNum", label: "Const Number", icon: Sliders, color: "text-emerald-400" },
      ],
    },
    {
      name: "Logic & Control",
      nodes: [
        { type: "andGate", label: "AND Gate", icon: Binary, color: "text-teal-400" },
        { type: "orGate", label: "OR Gate", icon: Binary, color: "text-teal-400" },
        { type: "notGate", label: "NOT Gate", icon: Binary, color: "text-teal-400" },
        { type: "ifElseTrigger", label: "If / Else Branch", icon: GitBranch, color: "text-purple-400" },
      ],
    },
    {
      name: "AI & Scripts",
      nodes: [
        { type: "aiDetector", label: "AI Target Classifier", icon: ShieldCheck, color: "text-amber-400" },
        { type: "customCode", label: "Custom Code Script", icon: Code2, color: "text-purple-400" },
      ],
    },
    {
      name: "Outputs",
      nodes: [
        { type: "actionOutput", label: "Wi-Fi Webhook Alert", icon: Radio, color: "text-emerald-400" },
      ],
    },
  ];

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-border bg-card p-4 font-mono select-none overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border pb-3 mb-3">
        <Layers className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">Node Library Palette</span>
      </div>

      <p className="text-[0.65rem] text-muted-foreground mb-3 leading-relaxed">
        Drag nodes onto the workspace canvas. Click any wire/connector or press Delete to disconnect.
      </p>

      {/* Categorized Node Library */}
      <div className="flex flex-col gap-4 mb-6">
        {CATEGORIES.map((cat) => (
          <div key={cat.name} className="flex flex-col gap-1.5">
            <span className="text-[0.65rem] font-bold uppercase text-muted-foreground tracking-wider">{cat.name}</span>
            <div className="flex flex-col gap-1.5">
              {cat.nodes.map((tmpl) => {
                const Icon = tmpl.icon;
                return (
                  <div
                    key={tmpl.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, tmpl.type)}
                    onClick={() => addNode(tmpl.type, 200 + Math.random() * 100, 150 + Math.random() * 100)}
                    className="flex items-center justify-between p-2 rounded border border-border bg-background cursor-grab active:cursor-grabbing hover:border-amber-500/40 transition-all text-xs text-foreground font-semibold"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 ${tmpl.color}`} />
                      <span>{tmpl.label}</span>
                    </div>
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Scenario Control Panel */}
      <div className="mt-auto border-t border-border pt-3 flex flex-col gap-2">
        <span className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">Scenario Tester</span>
        <button
          onClick={randomizeInputs}
          className="flex items-center justify-center gap-2 rounded bg-purple-600/20 border border-purple-500/40 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-600/30 transition-all"
        >
          <Dices className="h-3.5 w-3.5" /> Randomize Cat/Target Event
        </button>
        <button
          onClick={() => void runScenario()}
          className="flex items-center justify-center gap-2 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-all"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> Run Full Scenario
        </button>
      </div>
    </aside>
  );
}
