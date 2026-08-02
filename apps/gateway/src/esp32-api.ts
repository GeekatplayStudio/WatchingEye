/**
 * ESP32 Hardware Flashing & Telemetry API router.
 */
import type { FastifyInstance } from "fastify";
import { generateEsp32MicroFirmware, type Esp32FirmwareOptions } from "./esp32-generator.js";

interface TelemetryPayload {
  node_id: string;
  board?: string;
  rssi?: number;
  free_heap?: number;
  free_psram?: number;
  uptime_s?: number;
  total_frames?: number;
  sd_card?: boolean;
  target_class?: string;
}

interface DeviceRecord {
  nodeId: string;
  board: string;
  ipAddress?: string;
  rssi: number;
  freeHeap: number;
  freePsram: number;
  uptimeSeconds: number;
  totalFrames: number;
  sdCardMounted: boolean;
  activeTarget: string;
  lastSeenAt: string;
}

const activeDevices = new Map<string, DeviceRecord>();

export async function registerEsp32Routes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/esp32/generate
   * Generate minified ESP32-S3 C++ sketch code tailored for Freenove ESP32-S3 CAM.
   */
  app.post("/api/esp32/generate", async (req, reply) => {
    const opts = req.body as Esp32FirmwareOptions;
    if (!opts.nodeId || !opts.targetClass) {
      return reply.status(400).send({ error: "nodeId and targetClass are required" });
    }

    const sketchCode = generateEsp32MicroFirmware({
      nodeId: opts.nodeId,
      wifiSsid: opts.wifiSsid || "WatchingEye_Mesh",
      wifiPass: opts.wifiPass || "securepass123",
      targetClass: opts.targetClass,
      behaviorTrigger: opts.behaviorTrigger || "none",
      confidenceThreshold: opts.confidenceThreshold || 0.80,
      notifyUrl: opts.notifyUrl || "http://192.168.1.100:8080/api/classify",
      boardModel: opts.boardModel || "freenove_esp32_s3",
      sdCardRecord: opts.sdCardRecord !== false,
    });

    return reply.send({
      nodeId: opts.nodeId,
      targetClass: opts.targetClass,
      boardModel: opts.boardModel || "freenove_esp32_s3",
      sketchCode,
    });
  });

  /**
   * POST /api/esp32/telemetry
   * Ingest live telemetry payload from an ESP32 edge camera.
   */
  app.post("/api/esp32/telemetry", async (req, reply) => {
    const body = req.body as TelemetryPayload;
    if (!body || !body.node_id) {
      return reply.status(400).send({ error: "node_id missing in telemetry" });
    }

    const record: DeviceRecord = {
      nodeId: body.node_id,
      board: body.board || "Freenove ESP32-S3 CAM",
      rssi: body.rssi ?? 0,
      freeHeap: body.free_heap ?? 0,
      freePsram: body.free_psram ?? 0,
      uptimeSeconds: body.uptime_s ?? 0,
      totalFrames: body.total_frames ?? 0,
      sdCardMounted: body.sd_card ?? false,
      activeTarget: body.target_class || "none",
      lastSeenAt: new Date().toISOString(),
    };

    activeDevices.set(body.node_id, record);

    return reply.send({ ok: true, registeredNodes: activeDevices.size });
  });

  /**
   * GET /api/esp32/nodes
   * List all active ESP32 edge camera nodes and their health telemetry.
   */
  app.get("/api/esp32/nodes", async (_req, reply) => {
    const list = Array.from(activeDevices.values());
    return reply.send({ nodes: list });
  });

  /**
   * GET /api/esp32/stream-info
   * Return ESP32 connection instructions and current status.
   */
  app.get("/api/esp32/stream-info", async (_req, reply) => {
    return reply.send({
      port: "COM6",
      baud: 921600,
      apSsid: "vcode",
      apIpStream: "http://192.168.4.24:81/stream",
      apIpCapture: "http://192.168.4.24/capture",
      usbStatus: "ACTIVE_STREAMING",
    });
  });

  /**
   * GET /api/esp32/mjpeg-proxy
   * Proxy cross-origin ESP32 Wi-Fi MJPEG streams with clean CORS headers so HTML5 Canvas is never tainted.
   */
  app.get("/api/esp32/mjpeg-proxy", async (req, reply) => {
    const query = req.query as { url?: string };
    const streamUrl = query.url || "http://192.168.4.24:81/stream";

    try {
      const response = await fetch(streamUrl);
      if (!response.ok || !response.body) {
        return reply.status(502).send({ error: "Failed to connect to ESP32 stream" });
      }

      const contentType = response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame";
      reply.raw.setHeader("Content-Type", contentType);
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
      reply.raw.setHeader("Access-Control-Allow-Headers", "*");

      const reader = response.body.getReader();
      req.raw.on("close", () => {
        void reader.cancel();
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } catch (err) {
      if (!reply.raw.headersSent) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : "Proxy error" });
      }
    }
  });
}
