export type SocketType = "trigger" | "data";
export type SocketDataType = "number" | "boolean" | "string" | "any";

export interface PortDefinition {
  id: string;
  name: string;
  type: SocketType;
  dataType?: SocketDataType;
  value?: any;
}

export type ExecutionState = "idle" | "running" | "success" | "error";

export interface NodeData extends Record<string, any> {
  label: string;
  type: string;
  category: "Inputs" | "Logic" | "Control Flow" | "Math & Compare" | "Data & Text" | "Outputs" | "AI & Scripts" | "Neural Network" | "AI Model";
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  config?: Record<string, any>;
  executionState?: ExecutionState;
  errorMessage?: string;
  lastExecuted?: string;
  targetClass?: string;
  behavior?: string;
  confidence?: number;
  customCode?: string;
  codeLang?: "cpp" | "rust" | "typescript" | "python";
  webhookUrl?: string;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: NodeData["category"];
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  config?: Record<string, any>;
}

const ENABLED_INPUT: PortDefinition = { id: "enabled", name: "Enabled", type: "data", dataType: "boolean", value: true };

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = {
  // Inputs
  triggerInput: {
    type: "triggerInput",
    label: "Manual Trigger",
    category: "Inputs",
    description: "Manual trigger button to start execution paths.",
    inputs: [],
    outputs: [{ id: "triggerOut", name: "Trigger", type: "trigger" }],
  },
  cameraInput: {
    type: "cameraInput",
    label: "ESP32-S3 Camera Stream",
    category: "Inputs",
    description: "Live camera frame stream and motion detector trigger.",
    inputs: [],
    outputs: [
      { id: "frameOut", name: "Frame Grid", type: "data", dataType: "any", value: "frame_data" },
      { id: "triggerOut", name: "On Motion", type: "trigger" },
    ],
  },
  constNum: {
    type: "constNum",
    label: "Constant Number",
    category: "Inputs",
    description: "Outputs a constant numerical value.",
    inputs: [],
    outputs: [{ id: "value", name: "Value", type: "data", dataType: "number" }],
    config: { value: 5 },
  },
  constBool: {
    type: "constBool",
    label: "Constant Boolean",
    category: "Inputs",
    description: "Outputs a true/false value.",
    inputs: [],
    outputs: [{ id: "value", name: "Value", type: "data", dataType: "boolean" }],
    config: { value: true },
  },
  constString: {
    type: "constString",
    label: "Constant String",
    category: "Inputs",
    description: "Outputs a text value.",
    inputs: [],
    outputs: [{ id: "value", name: "Value", type: "data", dataType: "string" }],
    config: { value: "cat" },
  },

  // Logic Gates
  andGate: {
    type: "andGate",
    label: "AND Gate",
    category: "Logic",
    description: "Logical AND operation. True only if both inputs are true.",
    inputs: [
      { id: "a", name: "A", type: "data", dataType: "boolean", value: true },
      { id: "b", name: "B", type: "data", dataType: "boolean", value: true },
      ENABLED_INPUT,
    ],
    outputs: [{ id: "out", name: "Out", type: "data", dataType: "boolean" }],
  },
  orGate: {
    type: "orGate",
    label: "OR Gate",
    category: "Logic",
    description: "Logical OR operation. True if at least one input is true.",
    inputs: [
      { id: "a", name: "A", type: "data", dataType: "boolean", value: false },
      { id: "b", name: "B", type: "data", dataType: "boolean", value: false },
      ENABLED_INPUT,
    ],
    outputs: [{ id: "out", name: "Out", type: "data", dataType: "boolean" }],
  },
  notGate: {
    type: "notGate",
    label: "NOT Gate",
    category: "Logic",
    description: "Inverts boolean input.",
    inputs: [
      { id: "in", name: "In", type: "data", dataType: "boolean", value: false },
      ENABLED_INPUT,
    ],
    outputs: [{ id: "out", name: "Out", type: "data", dataType: "boolean" }],
  },

  // Control Flow
  ifElseTrigger: {
    type: "ifElseTrigger",
    label: "If / Else Branch",
    category: "Control Flow",
    description: "Routes execution flow based on condition boolean.",
    inputs: [
      { id: "triggerIn", name: "Run", type: "trigger" },
      { id: "condition", name: "Condition", type: "data", dataType: "boolean", value: true },
    ],
    outputs: [
      { id: "trueOut", name: "If True", type: "trigger" },
      { id: "falseOut", name: "If False", type: "trigger" },
    ],
  },
  delayNode: {
    type: "delayNode",
    label: "Delay Timer",
    category: "Control Flow",
    description: "Delays trigger execution by specified milliseconds.",
    inputs: [
      { id: "triggerIn", name: "Run", type: "trigger" },
      { id: "ms", name: "Delay (ms)", type: "data", dataType: "number", value: 1000 },
    ],
    outputs: [{ id: "triggerOut", name: "Done", type: "trigger" }],
  },

  // Math & Compare
  compareNode: {
    type: "compareNode",
    label: "Compare Node",
    category: "Math & Compare",
    description: "Compares A and B (> , <, ==, >=, <=, !=).",
    inputs: [
      { id: "a", name: "A", type: "data", dataType: "number", value: 10 },
      { id: "b", name: "B", type: "data", dataType: "number", value: 5 },
      ENABLED_INPUT,
    ],
    outputs: [{ id: "out", name: "Out", type: "data", dataType: "boolean" }],
    config: { operator: ">" },
  },

  // AI & Scripts
  aiDetector: {
    type: "aiDetector",
    label: "AI Target Classifier",
    category: "AI & Scripts",
    description: "YOLO/ONNX AI Object & Behavior Classifier.",
    inputs: [
      { id: "triggerIn", name: "Run", type: "trigger" },
      { id: "frameIn", name: "Frame", type: "data", dataType: "any" },
    ],
    outputs: [
      { id: "triggerOut", name: "On Match", type: "trigger" },
      { id: "scoreOut", name: "Confidence", type: "data", dataType: "number", value: 0.88 },
    ],
    config: { targetClass: "cat", behavior: "none", confidence: 0.80 },
  },
  customCode: {
    type: "customCode",
    label: "Custom Code Script Node",
    category: "AI & Scripts",
    description: "Inline engineer C++, Rust, Python, or TypeScript code block.",
    inputs: [{ id: "triggerIn", name: "Run", type: "trigger" }],
    outputs: [{ id: "triggerOut", name: "Out", type: "trigger" }],
    config: { codeLang: "cpp", customCode: "// inline custom logic" },
  },

  // Outputs
  loggerNode: {
    type: "loggerNode",
    label: "Debug Console Log",
    category: "Outputs",
    description: "Logs input value to execution console.",
    inputs: [
      { id: "triggerIn", name: "Log", type: "trigger" },
      { id: "message", name: "Message", type: "data", dataType: "any" },
    ],
    outputs: [],
  },
  actionOutput: {
    type: "actionOutput",
    label: "Wi-Fi Alert Webhook",
    category: "Outputs",
    description: "Triggers HTTP webhook / hardware actuator alert.",
    inputs: [{ id: "triggerIn", name: "Alert", type: "trigger" }],
    outputs: [],
    config: { webhookUrl: "http://192.168.1.100:8080/api/classify" },
  },
};
