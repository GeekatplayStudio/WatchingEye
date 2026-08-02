"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionLineType,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useNodeEditorStore } from "./use-node-editor-store";
import { nodeTypes } from "./custom-nodes";
import { QuickSearchMenu } from "./quick-search-menu";
import { MUTED_COLORS } from "@/lib/logiboard/node-styles";

function FlowCanvas() {
  const nodes = useNodeEditorStore((state) => state.nodes);
  const edges = useNodeEditorStore((state) => state.edges);
  const onNodesChange = useNodeEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useNodeEditorStore((state) => state.onEdgesChange);
  const onEdgesDelete = useNodeEditorStore((state) => state.onEdgesDelete);
  const deleteSelectedNodes = useNodeEditorStore((state) => state.deleteSelectedNodes);
  const setSelectedNodeId = useNodeEditorStore((state) => state.setSelectedNodeId);
  const onConnect = useNodeEditorStore((state) => state.onConnect);
  const addNode = useNodeEditorStore((state) => state.addNode);

  const { screenToFlowPosition } = useReactFlow();

  const [searchMenu, setSearchMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    flowX: number;
    flowY: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    flowX: 0,
    flowY: 0,
  });

  // Highlight selected edge and render floating data payload text badge
  const styledEdges = edges.map((e) => ({
    ...e,
    style: {
      stroke: e.selected ? "#f59e0b" : "#B99B72",
      strokeWidth: e.selected ? 4 : 2,
      filter: e.selected ? "drop-shadow(0 0 10px #f59e0b)" : undefined,
      cursor: "pointer",
    },
    labelStyle: {
      fill: e.selected ? "#f59e0b" : "#e4e4e7",
      fontWeight: 700,
      fontSize: 10,
      fontFamily: "monospace",
    },
    labelBgStyle: {
      fill: "#09090b",
      rx: 4,
      ry: 4,
      stroke: e.selected ? "#f59e0b" : "#3f3f46",
    },
    labelBgPadding: [6, 4] as [number, number],
  }));

  // Keyboard shortcut listener for Delete & Backspace keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isInput) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelectedNodes();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelectedNodes]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position.x - 100, position.y - 40);
    },
    [screenToFlowPosition, addNode],
  );

  const onPaneContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      const pos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setSearchMenu({
        isOpen: true,
        x: event.clientX,
        y: event.clientY,
        flowX: pos.x - 100,
        flowY: pos.y - 40,
      });
    },
    [screenToFlowPosition],
  );

  return (
    <div className="flex-1 h-full w-full relative" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSearchMenu((prev) => ({ ...prev, isOpen: false }));
        }}
        onPaneContextMenu={onPaneContextMenu}
        onSelectionChange={({ nodes: selNodes }) => {
          if (selNodes && selNodes.length > 0) {
            setSelectedNodeId(selNodes[0].id);
          }
        }}
        onConnect={onConnect}
        nodeTypes={nodeTypes as any}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: MUTED_COLORS.amber, strokeWidth: 2 }}
        defaultEdgeOptions={{
          animated: true,
          deletable: true,
          focusable: true,
        }}
        fitView
        colorMode="dark"
        className="bg-zinc-950"
      >
        <Background color="#27272a" gap={16} size={1} />
        <Controls className="bg-zinc-900 border border-zinc-800 text-zinc-300 fill-zinc-300 [&_button]:border-zinc-800 [&_button]:bg-zinc-900 [&_button]:text-zinc-300 [&_button:hover]:bg-zinc-800" />
        <MiniMap
          style={{ background: "#09090b", border: "1px solid #27272a" }}
          nodeColor={(n) => {
            if (n.type === "cameraInput") return MUTED_COLORS.blue;
            if (n.type === "aiDetector") return MUTED_COLORS.amber;
            if (n.type === "customCode") return MUTED_COLORS.purple;
            if (n.type === "actionOutput") return MUTED_COLORS.emerald;
            return MUTED_COLORS.teal;
          }}
          maskColor="rgba(9, 9, 11, 0.7)"
        />
      </ReactFlow>

      {/* ComfyUI-style Right Click Node Search Menu Loader */}
      <QuickSearchMenu
        isOpen={searchMenu.isOpen}
        x={searchMenu.x}
        y={searchMenu.y}
        flowX={searchMenu.flowX}
        flowY={searchMenu.flowY}
        onClose={() => setSearchMenu((prev) => ({ ...prev, isOpen: false }))}
        onSelectNode={(type, fx, fy) => addNode(type, fx, fy)}
      />
    </div>
  );
}

export function LogiBoardCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
