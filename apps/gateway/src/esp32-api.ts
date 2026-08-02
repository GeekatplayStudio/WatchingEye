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
   * Proxy cross-origin ESP32 Wi-Fi MJPEG streams with clean CORS headers and automatic mDNS/AP failover.
   */
  app.get("/api/esp32/mjpeg-proxy", async (req, reply) => {
    const query = req.query as { url?: string };
    const primaryUrl = query.url || "http://192.168.4.24:81/stream";

    // Candidate stream endpoints if primary IP changed on router restart
    const candidateUrls = Array.from(new Set([
      primaryUrl,
      "http://watchingeye-cam1.local:81/stream",
      "http://192.168.4.1:81/stream",
      "http://192.168.4.24:81/stream",
    ]));

    let response: Response | null = null;
    try {
      response = await Promise.any(
        candidateUrls.map(async (url) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1200);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok && res.body) return res;
          throw new Error("Failed to fetch candidate stream");
        })
      );
    } catch {
      // All candidates failed
    }

    if (!response || !response.body) {
      // Stream neutral fallback JPEG frame to keep browser <img /> healthy with zero 502 Bad Gateway console errors
      reply.raw.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=frame");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
      reply.raw.setHeader("Access-Control-Allow-Headers", "*");

      const fallbackFrame = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
        0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
        0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
        0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
        0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
        0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
        0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
        0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9
      ]);

      const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${fallbackFrame.length}\r\n\r\n`;
      reply.raw.write(header);
      reply.raw.write(fallbackFrame);
      reply.raw.write("\r\n");
      return reply.raw.end();
    }

    try {
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
