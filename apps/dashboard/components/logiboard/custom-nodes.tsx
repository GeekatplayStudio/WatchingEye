import React, { memo } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useNodeEditorStore, NodeData, NodePort } from "./use-node-editor-store";
import { Play, Trash2, Camera, ShieldCheck, Code2, Radio } from "lucide-react";
import { getCategoryStyles, getExecutionStyles, getPortColor } from "@/lib/logiboard/node-styles";

const CustomNodeComponent = ({ id, type, data, selected }: NodeProps<Node<NodeData>>) => {
  const deleteNode = useNodeEditorStore((state) => state.deleteNode);
  const updateNodeConfig = useNodeEditorStore((state) => state.updateNodeConfig);
  const triggerNode = useNodeEditorStore((state) => state.triggerNode);

  const categoryStyles = getCategoryStyles(data.category || "Logic", selected);
  const executionStyles = getExecutionStyles(data.executionState || "idle");

  const handleRunNode = () => {
    void triggerNode(id, "triggerOut");
  };

  return (
    <div
      className={`min-w-[220px] rounded-xl border bg-zinc-950/90 backdrop-blur-md text-zinc-100 shadow-2xl transition-all duration-200 ${categoryStyles.border} ${executionStyles}`}
    >
      {/* Node Header Bar */}
      <div className={`flex items-center justify-between px-3.5 py-2 rounded-t-xl border-b text-xs font-mono font-semibold ${categoryStyles.headerBg}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${categoryStyles.accent}`} />
          {type === "cameraInput" && <Camera className="w-3.5 h-3.5 text-sky-400" />}
          {type === "aiDetector" && <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />}
          {type === "customCode" && <Code2 className="w-3.5 h-3.5 text-purple-400" />}
          {type === "actionOutput" && <Radio className="w-3.5 h-3.5 text-emerald-400" />}
          <span>{data.label}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRunNode}
            className="p-1 hover:text-amber-400 text-zinc-400 transition"
            title="Execute node"
          >
            <Play className="w-3 h-3 fill-current" />
          </button>
          <button
            onClick={() => deleteNode(id)}
            className="p-1 hover:text-rose-400 text-zinc-400 transition"
            title="Delete node"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Node Body & Handles */}
      <div className="p-3 font-mono text-[0.7rem] flex flex-col gap-2.5">
        {/* Input Handles (Left Ports) */}
        {data.inputs && data.inputs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {data.inputs.map((port: NodePort) => (
              <div key={port.id} className="relative flex items-center gap-2 pl-3">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.id}
                  style={{
                    left: -16,
                    width: 10,
                    height: 10,
                    backgroundColor: getPortColor(port.type, port.dataType),
                    border: "2px solid #09090b",
                  }}
                />
                <span className="text-zinc-400">{port.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Inline Parameters / Form Inputs */}
        {(type === "aiDetector" || type === "nlTrigger") && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[0.65rem] text-amber-300 font-semibold">Natural Language Trigger Condition:</span>
            <input
              type="text"
              value={(data.nlPrompt as string) || (data.targetClass as string) || "person waving or pulling out weapon"}
              onChange={(e) => updateNodeConfig(id, { nlPrompt: e.target.value, targetClass: e.target.value })}
              placeholder="e.g. 'person waving', 'weapon drawn', 'cat'"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-amber-400 text-[0.65rem] focus:outline-none placeholder:text-zinc-600 font-mono"
            />
          </div>
        )}

        {type === "customCode" && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[0.65rem] text-purple-300 font-semibold">Custom Script Snippet:</span>
            <textarea
              rows={2}
              value={(data.customCode as string) || ""}
              onChange={(e) => updateNodeConfig(id, { customCode: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-[0.65rem] text-purple-300 font-mono focus:outline-none"
            />
          </div>
        )}

        {/* Output Handles (Right Ports) */}
        {data.outputs && data.outputs.length > 0 && (
          <div className="flex flex-col gap-1.5 items-end pt-1">
            {data.outputs.map((port: NodePort) => (
              <div key={port.id} className="relative flex items-center gap-2 pr-3">
                <span className="text-zinc-400">{port.name}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port.id}
                  style={{
                    right: -16,
                    width: 10,
                    height: 10,
                    backgroundColor: getPortColor(port.type, port.dataType),
                    border: "2px solid #09090b",
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const nodeTypes = {
  cameraInput: memo(CustomNodeComponent),
  aiDetector: memo(CustomNodeComponent),
  customCode: memo(CustomNodeComponent),
  actionOutput: memo(CustomNodeComponent),
};
