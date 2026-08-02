"use client";

import React from "react";
import { Settings2, X, Play, Trash2, Code2, Terminal, Tag } from "lucide-react";
import { useNodeEditorStore } from "./use-node-editor-store";

export function NodeConfigPanel() {
  const selectedNodeId = useNodeEditorStore((state) => state.selectedNodeId);
  const nodes = useNodeEditorStore((state) => state.nodes);
  const setSelectedNodeId = useNodeEditorStore((state) => state.setSelectedNodeId);
  const updateNodeConfig = useNodeEditorStore((state) => state.updateNodeConfig);
  const deleteNode = useNodeEditorStore((state) => state.deleteNode);
  const triggerNode = useNodeEditorStore((state) => state.triggerNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="w-80 shrink-0 border-l border-border bg-card p-4 text-xs font-mono text-muted-foreground flex flex-col items-center justify-center text-center">
        <Settings2 className="h-8 w-8 mb-2 text-muted-foreground/30" />
        Select any node on the canvas to inspect and configure its parameters, custom code, and execution state.
      </div>
    );
  }

  const { data } = selectedNode;

  return (
    <div className="w-80 shrink-0 border-l border-border bg-card p-4 font-mono text-xs flex flex-col gap-4 overflow-y-auto">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-amber-500" />
          <span className="font-bold uppercase tracking-wider text-foreground">Node Inspector</span>
        </div>
        <button
          onClick={() => setSelectedNodeId(null)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Selected Node Identity Info */}
      <div className="flex flex-col gap-1.5 rounded border border-border bg-background p-3">
        <div className="flex items-center justify-between text-foreground font-semibold">
          <span>{data.label}</span>
          <span className="text-[0.65rem] text-amber-400 font-mono">[{selectedNode.id}]</span>
        </div>
        <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
          <Tag className="h-3 w-3 text-sky-400" />
          <span>Category: <strong>{data.category}</strong></span>
        </div>
      </div>

      {/* Inline Configuration Options */}
      {(selectedNode.type === "aiDetector" || selectedNode.type === "nlTrigger") && (
        <div className="flex flex-col gap-3 rounded border border-border bg-background p-3">
          <span className="font-semibold text-amber-400 uppercase text-[0.7rem]">Natural Language Trigger Settings</span>

          <div>
            <label className="text-[0.65rem] uppercase text-muted-foreground">Natural Language Trigger Condition / Prompt</label>
            <textarea
              rows={3}
              value={(data.nlPrompt as string) || (data.targetClass as string) || "person waving or pulling out weapon"}
              onChange={(e) => updateNodeConfig(selectedNode.id, { nlPrompt: e.target.value, targetClass: e.target.value })}
              placeholder="e.g. 'person waving', 'person pulling out a weapon', 'military vehicle', 'cat in yard'"
              className="mt-1 w-full rounded border border-border bg-card p-2 text-xs text-amber-300 font-mono focus:outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
              <span>Confidence Threshold</span>
              <span className="text-amber-400">{Math.round(((data.confidence as number) || 0.8) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.50"
              max="0.95"
              step="0.05"
              value={(data.confidence as number) || 0.8}
              onChange={(e) => updateNodeConfig(selectedNode.id, { confidence: parseFloat(e.target.value) })}
              className="mt-1 w-full accent-amber-500"
            />
          </div>
        </div>
      )}

      {selectedNode.type === "customCode" && (
        <div className="flex flex-col gap-2 rounded border border-border bg-background p-3">
          <span className="font-semibold text-purple-400 uppercase text-[0.7rem] flex items-center gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Inline Code Editor
          </span>
          <div>
            <label className="text-[0.65rem] uppercase text-muted-foreground">Target Language</label>
            <select
              value={(data.codeLang as string) || "cpp"}
              onChange={(e) => updateNodeConfig(selectedNode.id, { codeLang: e.target.value })}
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground"
            >
              <option value="cpp">C++ (ESP32-S3 Arduino)</option>
              <option value="rust">Rust (vision-engine)</option>
              <option value="typescript">TypeScript (Gateway)</option>
              <option value="python">Python (OpenCV/ONNX)</option>
            </select>
          </div>
          <textarea
            rows={5}
            value={(data.customCode as string) || ""}
            onChange={(e) => updateNodeConfig(selectedNode.id, { customCode: e.target.value })}
            className="w-full rounded border border-border bg-card p-2 text-[0.65rem] text-purple-300 font-mono focus:outline-none"
          />
        </div>
      )}

      {/* Execution Output Stream */}
      <div className="flex flex-col gap-1.5 rounded border border-border bg-background p-3">
        <span className="font-semibold text-foreground uppercase text-[0.7rem] flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 text-sky-400" /> Execution Status
        </span>
        <div className="flex items-center justify-between text-[0.65rem]">
          <span className="text-muted-foreground">State:</span>
          <span className="font-bold uppercase text-emerald-400">{data.executionState || "idle"}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => void triggerNode(selectedNode.id, "triggerOut")}
          className="flex-1 flex items-center justify-center gap-1.5 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> Run Node
        </button>
        <button
          onClick={() => deleteNode(selectedNode.id)}
          className="flex items-center justify-center gap-1.5 rounded bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}
