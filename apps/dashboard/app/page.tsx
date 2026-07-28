"use client";

/**
 * Live Monitor: camera grid, connection status, and the real-time
 * detection feed with per-event evidence (zero-black-box view).
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventCard } from "@/components/event-card";
import { useLiveEvents } from "@/lib/use-live-events";
import type { Camera } from "@/lib/types";
import { Video } from "lucide-react";

export default function MonitorPage() {
  const { events, connected } = useLiveEvents();
  const cameras = useQuery({
    queryKey: ["cameras"],
    queryFn: async (): Promise<{ cameras: Camera[] }> => {
      const res = await fetch("/api/cameras");
      if (!res.ok) throw new Error(`gateway ${res.status}`);
      return res.json() as Promise<{ cameras: Camera[] }>;
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Live Monitor</h1>
        <Badge variant={connected ? "success" : "danger"}>
          {connected ? "● live" : "○ disconnected"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(cameras.data?.cameras ?? []).map((cam) => (
          <Card key={cam.id}>
            <CardContent className="p-4">
              <div className="flex aspect-video items-center justify-center rounded-md bg-muted">
                <Video className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-medium">{cam.location}</span>
                <Badge variant="outline">{cam.kind}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {cameras.isError && (
          <Card className="sm:col-span-3">
            <CardContent className="p-4 text-sm text-danger">
              Gateway unreachable — start it with <code>scripts/run gateway</code>.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detection Feed</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[32rem] space-y-3 overflow-y-auto">
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Waiting for events… (the gateway demo stream emits every few seconds)
            </p>
          )}
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
