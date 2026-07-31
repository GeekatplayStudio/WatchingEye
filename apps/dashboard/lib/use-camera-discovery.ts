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
    try {
      const res = await post<{ candidates: Candidate[] }>("/api/cameras/scan", { cidr });
      setCandidates(res.candidates);
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
    error,
    scan,
    inventory,
  };
}
