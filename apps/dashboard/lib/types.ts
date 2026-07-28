/** Types mirrored from the gateway (which mirrors the Rust schemas). */

export interface DetectionEvent {
  id: string;
  objectId: string;
  class: string;
  kind: string;
  zone?: string;
  confidence: number;
  frames: number[];
  cameraId: string;
  timestamp: string;
  evidence: Array<{ label: string; description: string }>;
  model: string;
  promptVersion?: string;
  risk?: number;
  rejectedReason?: string;
  source: "engine";
}

export interface Settings {
  minDetectionConfidence: number;
  gateMinConfidence: number;
  gateConsecutiveFrames: number;
  policyMinConfidence: number;
  allowedActions: string[];
}

export interface Camera {
  id: string;
  kind: string;
  location: string;
}
