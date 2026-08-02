/**
 * LogiBoard Flow Simulation & Input Testing Engine.
 *
 * Runs topological evaluation of node graphs against test input data,
 * providing step-by-step execution logs and node state outputs.
 */

import { FlowNode, FlowEdge } from "./multi-lang-generator";

export interface SimulationInputs {
  targetClass: string;
  confidence: number;
  behavior: string;
  motionDetected: boolean;
  simulatedFrameWidth: number;
  simulatedFrameHeight: number;
}

export interface NodeExecutionState {
  nodeId: string;
  status: "idle" | "running" | "passed" | "failed";
  outputValue?: unknown;
  message?: string;
}

export interface SimulationResult {
  passed: boolean;
  totalNodes: number;
  executedNodes: number;
  nodeStates: Record<string, NodeExecutionState>;
  logs: string[];
}

export function runFlowSimulation(
  nodes: FlowNode[],
  edges: FlowEdge[],
  inputs: SimulationInputs,
): SimulationResult {
  const logs: string[] = [];
  const nodeStates: Record<string, NodeExecutionState> = {};
  let overallPassed = true;

  logs.push(`[Simulator] Initializing graph execution test...`);
  logs.push(`[Simulator] Inputs: Class="${inputs.targetClass}", Confidence=${(inputs.confidence * 100).toFixed(0)}%, Behavior="${inputs.behavior}", Motion=${inputs.motionDetected}`);

  // Initialize node states
  for (const node of nodes) {
    nodeStates[node.id] = { nodeId: node.id, status: "idle" };
  }

  // 1. Evaluate Camera / Frame Input Nodes
  const cameraNodes = nodes.filter((n) => n.type === "cameraInput");
  for (const camNode of cameraNodes) {
    nodeStates[camNode.id] = {
      nodeId: camNode.id,
      status: "passed",
      outputValue: { frame: "frame_001.jpg", width: inputs.simulatedFrameWidth, height: inputs.simulatedFrameHeight },
      message: `Frame acquired (${inputs.simulatedFrameWidth}x${inputs.simulatedFrameHeight})`,
    };
    logs.push(`[Node:${camNode.id}] Camera Frame Acquired -> PASSED`);
  }

  // 2. Evaluate AI Detection / NL Trigger Nodes
  const aiNodes = nodes.filter((n) => n.type === "aiDetector" || n.type === "nlTrigger");
  for (const aiNode of aiNodes) {
    const requiredClass = aiNode.data.targetClass || "cat";
    const requiredConf = aiNode.data.confidence || 0.80;
    const requiredBehavior = aiNode.data.behavior || "none";

    const classMatches = requiredClass.toLowerCase() === inputs.targetClass.toLowerCase();
    const confMatches = inputs.confidence >= requiredConf;
    const behaviorMatches = requiredBehavior === "none" || requiredBehavior.toLowerCase() === inputs.behavior.toLowerCase();

    if (classMatches && confMatches && behaviorMatches) {
      nodeStates[aiNode.id] = {
        nodeId: aiNode.id,
        status: "passed",
        outputValue: { score: inputs.confidence, matchedClass: inputs.targetClass, behavior: inputs.behavior },
        message: `Condition Matched! Score: ${(inputs.confidence * 100).toFixed(0)}%`,
      };
      logs.push(`[Node:${aiNode.id}] AI Trigger Match (${inputs.targetClass}, ${(inputs.confidence * 100).toFixed(0)}%) -> PASSED`);
    } else {
      nodeStates[aiNode.id] = {
        nodeId: aiNode.id,
        status: "failed",
        message: `Condition Failed (Req: ${requiredClass} >=${requiredConf * 100}%, Got: ${inputs.targetClass} ${inputs.confidence * 100}%)`,
      };
      logs.push(`[Node:${aiNode.id}] AI Trigger Failed -> FAILED`);
      overallPassed = false;
    }
  }

  // 3. Evaluate Custom Code Nodes
  const customNodes = nodes.filter((n) => n.type === "customCode");
  for (const customNode of customNodes) {
    if (overallPassed) {
      nodeStates[customNode.id] = {
        nodeId: customNode.id,
        status: "passed",
        outputValue: { customExec: "return true;" },
        message: "Custom Code Executed Cleanly",
      };
      logs.push(`[Node:${customNode.id}] Custom Code Executed -> PASSED`);
    } else {
      nodeStates[customNode.id] = {
        nodeId: customNode.id,
        status: "idle",
        message: "Skipped due to prior failure",
      };
    }
  }

  // 4. Evaluate Action / Output Nodes
  const actionNodes = nodes.filter((n) => n.type === "actionOutput");
  for (const actionNode of actionNodes) {
    if (overallPassed) {
      nodeStates[actionNode.id] = {
        nodeId: actionNode.id,
        status: "passed",
        outputValue: { actionSent: true, webhook: actionNode.data.webhookUrl || "http://gateway/api/classify" },
        message: "Notification Alert Sent!",
      };
      logs.push(`[Node:${actionNode.id}] Action Notification Triggered -> PASSED`);
    } else {
      nodeStates[actionNode.id] = {
        nodeId: actionNode.id,
        status: "failed",
        message: "Action suppressed (conditions not met)",
      };
      logs.push(`[Node:${actionNode.id}] Action Suppressed -> FAILED`);
    }
  }

  logs.push(`[Simulator] Simulation Completed. Result: ${overallPassed ? "SUCCESS" : "NO TRIGGER"}`);

  return {
    passed: overallPassed,
    totalNodes: nodes.length,
    executedNodes: Object.values(nodeStates).filter((s) => s.status !== "idle").length,
    nodeStates,
    logs,
  };
}
