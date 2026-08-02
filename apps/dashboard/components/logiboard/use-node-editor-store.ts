import { create } from "zustand";
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from "@xyflow/react";

export interface NodePort {
  id: string;
  name: string;
  type: "trigger" | "data";
  dataType?: "number" | "boolean" | "string" | "any";
  value?: any;
}

export type NodeData = Record<string, unknown> & {
  label: string;
  category: "Inputs" | "Logic" | "Control Flow" | "Math & Compare" | "Data & Text" | "Outputs" | "AI & Scripts" | "AI Model";
  inputs: NodePort[];
  outputs: NodePort[];
  config?: Record<string, any>;
  executionState?: "idle" | "running" | "success" | "error";
  targetClass?: string;
  behavior?: string;
  confidence?: number;
  customCode?: string;
  codeLang?: "cpp" | "rust" | "typescript" | "python";
  webhookUrl?: string;
};

export interface NodeEditorState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  flowSpeedMs: number;
  setFlowSpeedMs: (ms: number) => void;
  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onEdgesDelete: (edgesToDelete: Edge[]) => void;
  deleteEdge: (id: string) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, x: number, y: number) => void;
  deleteNode: (id: string) => void;
  deleteSelectedNodes: () => void;
  updateNodeConfig: (id: string, config: Record<string, any>) => void;
  setSelectedNodeId: (id: string | null) => void;
  triggerNode: (nodeId: string, outputPortId: string) => Promise<void>;
  runScenario: () => Promise<void>;
  randomizeInputs: () => void;
}

let uniqueCounter = 1;

export const useNodeEditorStore = create<NodeEditorState>((set, get) => ({
  nodes: [
    {
      id: "node_cam_1",
      type: "cameraInput",
      position: { x: 50, y: 150 },
      data: {
        label: "ESP32-S3 Camera Feed",
        category: "Inputs",
        inputs: [],
        outputs: [
          { id: "frameOut", name: "Frame Grid", type: "data", dataType: "any", value: "frame_640x480" },
          { id: "triggerOut", name: "On Motion", type: "trigger" },
        ],
      },
    },
    {
      id: "node_ai_1",
      type: "aiDetector",
      position: { x: 340, y: 150 },
      data: {
        label: "AI Target Classifier",
        category: "AI & Scripts",
        targetClass: "person waving or pulling weapon",
        behavior: "waving",
        confidence: 0.85,
        inputs: [
          { id: "triggerIn", name: "Run", type: "trigger" },
          { id: "frameIn", name: "Frame", type: "data", dataType: "any" },
        ],
        outputs: [
          { id: "triggerOut", name: "On Match", type: "trigger" },
          { id: "scoreOut", name: "Confidence", type: "data", dataType: "number", value: 0.88 },
        ],
      },
    },
    {
      id: "node_code_1",
      type: "customCode",
      position: { x: 630, y: 150 },
      data: {
        label: "Custom Logic Gate",
        category: "AI & Scripts",
        codeLang: "cpp",
        customCode: "if (confidence > 0.85) {\n  digitalWrite(LED_FLASH_PIN, HIGH);\n}",
        inputs: [
          { id: "triggerIn", name: "Run", type: "trigger" },
          { id: "scoreIn", name: "Score", type: "data", dataType: "number" },
        ],
        outputs: [
          { id: "triggerOut", name: "Out", type: "trigger" },
        ],
      },
    },
    {
      id: "node_out_1",
      type: "actionOutput",
      position: { x: 920, y: 150 },
      data: {
        label: "Wi-Fi Alert Webhook",
        category: "Outputs",
        webhookUrl: "http://192.168.1.100:8080/api/classify",
        inputs: [
          { id: "triggerIn", name: "Alert", type: "trigger" },
        ],
        outputs: [],
      },
    },
  ],

  edges: [
    {
      id: "e1",
      source: "node_cam_1",
      sourceHandle: "triggerOut",
      target: "node_ai_1",
      targetHandle: "triggerIn",
      animated: true,
      label: "Motion Detected [640x480]",
    },
    {
      id: "e2",
      source: "node_ai_1",
      sourceHandle: "triggerOut",
      target: "node_code_1",
      targetHandle: "triggerIn",
      animated: true,
      label: "Match: Score 88%",
    },
    {
      id: "e3",
      source: "node_code_1",
      sourceHandle: "triggerOut",
      target: "node_out_1",
      targetHandle: "triggerIn",
      animated: true,
      label: "Gate Passed [HIGH]",
    },
  ],

  selectedNodeId: null,
  flowSpeedMs: 400,

  setFlowSpeedMs: (ms) => set({ flowSpeedMs: ms }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onEdgesDelete: (edgesToDelete) => {
    const idsToDelete = new Set(edgesToDelete.map((e) => e.id));
    set({ edges: get().edges.filter((e) => !idsToDelete.has(e.id)) });
  },

  deleteEdge: (id) => {
    set({ edges: get().edges.filter((e) => e.id !== id) });
  },

  onConnect: (connection) => {
    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: "#B99B72", strokeWidth: 2 }, label: "Data Connected" },
        get().edges,
      ),
    });
  },

  addNode: (type, x, y) => {
    const id = `node_${type}_${uniqueCounter++}`;
    let category: NodeData["category"] = "Logic";
    let label = "Node";
    let inputs: NodePort[] = [{ id: "in", name: "In", type: "trigger" }];
    let outputs: NodePort[] = [{ id: "out", name: "Out", type: "trigger" }];

    if (type === "cameraInput") {
      category = "Inputs";
      label = "Camera Stream";
      inputs = [];
      outputs = [
        { id: "frameOut", name: "Frame", type: "data", dataType: "any" },
        { id: "triggerOut", name: "Motion", type: "trigger" },
      ];
    } else if (type === "aiDetector") {
      category = "AI & Scripts";
      label = "AI Target Classifier";
      inputs = [
        { id: "triggerIn", name: "Run", type: "trigger" },
        { id: "frameIn", name: "Frame", type: "data", dataType: "any" },
      ];
      outputs = [
        { id: "triggerOut", name: "On Match", type: "trigger" },
        { id: "scoreOut", name: "Score", type: "data", dataType: "number" },
      ];
    } else if (type === "customCode") {
      category = "AI & Scripts";
      label = "Custom Code Node";
      inputs = [{ id: "triggerIn", name: "Run", type: "trigger" }];
      outputs = [{ id: "triggerOut", name: "Out", type: "trigger" }];
    } else if (type === "andGate" || type === "orGate" || type === "notGate") {
      category = "Logic";
      label = type === "andGate" ? "AND Gate" : type === "orGate" ? "OR Gate" : "NOT Gate";
      inputs = [
        { id: "a", name: "A", type: "data", dataType: "boolean", value: true },
        { id: "b", name: "B", type: "data", dataType: "boolean", value: true },
      ];
      outputs = [{ id: "out", name: "Out", type: "data", dataType: "boolean" }];
    } else if (type === "ifElseTrigger") {
      category = "Control Flow";
      label = "If / Else Branch";
      inputs = [
        { id: "triggerIn", name: "Run", type: "trigger" },
        { id: "condition", name: "Condition", type: "data", dataType: "boolean", value: true },
      ];
      outputs = [
        { id: "trueOut", name: "If True", type: "trigger" },
        { id: "falseOut", name: "If False", type: "trigger" },
      ];
    } else if (type === "compareNode") {
      category = "Math & Compare";
      label = "Compare Node";
      inputs = [
        { id: "a", name: "A", type: "data", dataType: "number", value: 10 },
        { id: "b", name: "B", type: "data", dataType: "number", value: 5 },
      ];
      outputs = [{ id: "out", name: "Out", type: "data", dataType: "boolean" }];
    } else if (type === "actionOutput") {
      category = "Outputs";
      label = "Alert / Actuator";
      inputs = [{ id: "triggerIn", name: "Alert", type: "trigger" }];
      outputs = [];
    }

    const newNode: Node<NodeData> = {
      id,
      type,
      position: { x, y },
      data: {
        label,
        category,
        inputs,
        outputs,
        targetClass: "person waving or pulling weapon",
        confidence: 0.85,
        customCode: "// custom code snippet",
      },
    };

    set({ nodes: [...get().nodes, newNode] });
  },

  deleteNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },

  deleteSelectedNodes: () => {
    const selectedNodeIds = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id));
    const selectedEdgeIds = new Set(get().edges.filter((e) => e.selected).map((e) => e.id));

    set({
      nodes: get().nodes.filter((n) => !selectedNodeIds.has(n.id)),
      edges: get().edges.filter(
        (e) => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
      ),
      selectedNodeId: null,
    });
  },

  updateNodeConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...config } } : n)),
    });
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  triggerNode: async (nodeId, _outputPortId) => {
    const { nodes, flowSpeedMs } = get();
    set({
      nodes: nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, executionState: "running" } } : n,
      ),
    });

    setTimeout(() => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, executionState: "success" } } : n,
        ),
      });
    }, flowSpeedMs);
  },

  runScenario: async () => {
    const { nodes, edges, flowSpeedMs } = get();

    for (const node of nodes) {
      // Highlight node running
      set({
        nodes: get().nodes.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, executionState: "running" } } : n,
        ),
      });

      // Update outgoing edge labels with live data payload passing through
      const outgoingEdges = edges.filter((e) => e.source === node.id);
      if (outgoingEdges.length > 0) {
        set({
          edges: get().edges.map((e) => {
            if (e.source === node.id) {
              let payload = "Payload: Passed";
              if (node.type === "cameraInput") payload = "Frame [640x480] Motion: YES";
              else if (node.type === "aiDetector") payload = `Matched [${(node.data.targetClass as string) || "target"}] Score: ${Math.round(((node.data.confidence as number) || 0.8) * 100)}%`;
              else if (node.type === "customCode") payload = "Gate Condition: TRUE";
              else if (node.type === "actionOutput") payload = "Webhook Triggered: 200 OK";

              return { ...e, animated: true, label: payload };
            }
            return e;
          }),
        });
      }

      await new Promise((r) => setTimeout(r, flowSpeedMs));

      set({
        nodes: get().nodes.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, executionState: "success" } } : n,
        ),
      });
    }
  },

  randomizeInputs: () => {
    const nlPrompts = [
      "person waving hand SOS signal",
      "person pulling out weapon",
      "military tactical vehicle passing",
      "missing person in forest",
      "black cat near door",
      "delivery package left at porch",
      "dog barking near gate",
    ];
    const randomPrompt = nlPrompts[Math.floor(Math.random() * nlPrompts.length)];
    const randomConf = Math.round((0.55 + Math.random() * 0.42) * 100) / 100;

    set({
      nodes: get().nodes.map((n) => {
        if (n.type === "aiDetector" || n.type === "nlTrigger") {
          return {
            ...n,
            data: {
              ...n.data,
              nlPrompt: randomPrompt,
              targetClass: randomPrompt,
              confidence: randomConf,
              executionState: "running",
            },
          };
        }
        return n;
      }),
    });
  },
}));
