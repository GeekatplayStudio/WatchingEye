"use client";

/**
 * WebSocket hook: connects to the gateway's /ws stream, keeps the latest
 * events (newest first), and exposes connection state. Reconnects with a
 * fixed 3s backoff.
 */
import { useEffect, useRef, useState } from "react";
import type { DetectionEvent, Settings } from "./types";

const WS_URL = process.env.NEXT_PUBLIC_GATEWAY_WS ?? "ws://localhost:8080/ws";
const MAX_EVENTS = 100;

interface LiveState {
  events: DetectionEvent[];
  settings: Settings | null;
  connected: boolean;
}

export function useLiveEvents(): LiveState {
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let disposed = false;

    function connect() {
      socket = new WebSocket(WS_URL);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (msg: MessageEvent<string>) => {
        try {
          const data = JSON.parse(msg.data) as
            | { type: "event"; event: DetectionEvent }
            | { type: "settings"; settings: Settings };
          if (data.type === "event") {
            setEvents((prev) => [data.event, ...prev].slice(0, MAX_EVENTS));
          } else if (data.type === "settings") {
            setSettings(data.settings);
          }
        } catch {
          // Ignore malformed frames; the gateway only sends JSON.
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) {
          retryRef.current = setTimeout(connect, 3000);
        }
      };
    }
    connect();

    return () => {
      disposed = true;
      if (retryRef.current !== undefined) clearTimeout(retryRef.current);
      socket?.close();
    };
  }, []);

  return { events, settings, connected };
}
