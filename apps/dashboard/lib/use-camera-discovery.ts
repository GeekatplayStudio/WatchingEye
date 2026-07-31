"use client";

/**
 * Client for the engine's camera discovery endpoints.
 *
 * Credentials are held in React state for the length of one request and sent
 * to the engine, which talks to the device directly. They are never written
 * to localStorage, never put in a URL, and never logged — a password in a
 * query string ends up in history and server logs, which is how camera
 * credentials usually leak.
 */
import { useCallback, useEffect, useState } from "react";

/** A local network worth scanning. */
export interface Interface {
  name: string;
  address: string;
  cidr: string;
  hosts: number;
}

/** A host that answered on a camera port or via ONVIF. */
export interface Candidate {
  address: string;
  open_ports: number[];
  hint: string;
  onvif_url: string | null;
}

/** One media profile — in practice one camera's main or sub stream. */
export interface OnvifProfile {
  token: string;
  name: string;
}

/** A scan in progress or complete. */
export interface ScanJob {
  id: string;
  cidr: string;
  state: "running" | "done" | "failed";
  candidates: Candidate[];
  error: string | null;
  elapsed_ms: number;
}

/** What an authenticated ONVIF interrogation returned. */
export interface OnvifInventory {
  device: {
    manufacturer: string;
    model: string;
    firmware: string;
    serial: string;
  };
  profiles: OnvifProfile[];
  /** `[profileToken, rtspUrl]` pairs. */
  streams: Array<[string, string]>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/engine${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // The engine reports a reason, not just a status; surface it verbatim so
    // the operator sees "enable ONVIF" rather than "502".
    let message = `engine ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      /* not JSON — keep the status */
    }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

/** State machine for the discovery panel. */
export function useCameraDiscovery() {
  const [interfaces, setInterfaces] = useState<Interface[]>([]);
  const [cidr, setCidr] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/engine/api/cameras/interfaces");
        if (!res.ok) return;
        const list = (await res.json()) as Interface[];
        setInterfaces(list);
        // Default to the first scannable network rather than guessing /24:
        // the wrong mask silently misses most of the address space.
        const usable = list.find((i) => i.hosts > 0);
        if (usable) setCidr(usable.cidr);
      } catch {
        setError("Vision engine unreachable — start it with: cargo run -p vision-engine");
      }
    })();
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setCandidates(null);
    setElapsedMs(0);
    try {
      // Started as a job and polled, not awaited in one request: a sweep can
      // outlast the dashboard proxy's 30s ceiling, and a scan that is merely
      // slow would come back as an indistinguishable 500.
      const { id } = await post<{ id: string }>("/api/cameras/scan/start", { cidr });

      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const res = await fetch(`/engine/api/cameras/scan/${id}`);
        if (!res.ok) throw new Error(`lost track of the scan (${res.status})`);
        const job = (await res.json()) as ScanJob;
        setElapsedMs(job.elapsed_ms);
        if (job.state === "done") {
          setCandidates(job.candidates);
          return;
        }
        if (job.state === "failed") {
          throw new Error(job.error ?? "scan failed");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, [cidr]);

  const inventory = useCallback(
    async (serviceUrl: string, user: string, password: string): Promise<OnvifInventory> =>
      post<OnvifInventory>("/api/cameras/onvif/inventory", {
        service_url: serviceUrl,
        user,
        password,
      }),
    [],
  );

  return {
    interfaces,
    cidr,
    setCidr,
    candidates,
    scanning,
    elapsedMs,
    error,
    scan,
    inventory,
  };
}
