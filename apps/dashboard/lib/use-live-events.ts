"use client";

/**
 * Live + recent events: hydrates from `GET /api/events/recent` on mount,
 * then merges WebSocket frames. Newest first, deduped by id, capped at 100.
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

/** Merge incoming events into the list: newest first, unique by id. */
export function mergeEvents(
  incoming: DetectionEvent[],
  existing: DetectionEvent[],
): DetectionEvent[] {
  const byId = new Map<string, DetectionEvent>();
  for (const e of [...incoming, ...existing]) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_EVENTS);
}

export function useLiveEvents(): LiveState {
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const res = await fetch("/api/events/recent?limit=100");
        if (!res.ok) return;
        const data = (await res.json()) as { events?: DetectionEvent[] };
        if (cancelled) return;
        const recent = data.events ?? [];
        setEvents((prev) => mergeEvents(recent, prev));
      } catch {
        // Gateway may be down at mount; WS reconnect will carry live traffic.
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

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
            setEvents((prev) => mergeEvents([data.event], prev));
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