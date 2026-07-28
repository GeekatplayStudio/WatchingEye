"use client";

/**
 * Health of the three back-end services, polled for the status icons.
 *
 * Unknown is distinct from down: before the first probe returns, the UI must
 * not claim a service is offline.
 */
import { useEffect, useState } from "react";

export type Health = "up" | "down" | "unknown";

export interface ServiceStatus {
  engine: Health;
  gateway: Health;
  ai: Health;
  aiModel?: string;
}

async function probe(url: string): Promise<[Health, unknown]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return ["down", null];
    return ["up", await res.json()];
  } catch {
    return ["down", null];
  }
}

export function useServiceStatus(intervalMs = 5000): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>({
    engine: "unknown",
    gateway: "unknown",
    ai: "unknown",
  });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const [engine] = await probe("/engine/health");
      const [gateway] = await probe("/api/health");
      const [ai, aiBody] = await probe("/api/ai/health");
      if (cancelled) return;
      const model = (aiBody as { model?: string } | null)?.model;
      setStatus({ engine, gateway, ai, ...(model !== undefined ? { aiModel: model } : {}) });
    }
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return status;
}
