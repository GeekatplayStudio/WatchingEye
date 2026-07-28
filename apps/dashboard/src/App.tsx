/**
 * App shell. Panels to come: live cameras, object timelines, agent
 * reasoning (zero-black-box view), heatmaps, replay, graph view, alerts.
 */
import { useQuery } from "@tanstack/react-query";

interface CameraListResponse {
  cameras: Array<{ id: string; kind: string; location: string }>;
}

/** Fetch the camera list from the gateway. */
async function fetchCameras(): Promise<CameraListResponse> {
  const res = await fetch("/api/cameras");
  if (!res.ok) {
    throw new Error(`gateway error: ${res.status}`);
  }
  return (await res.json()) as CameraListResponse;
}

/** Root dashboard component. */
export function App(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cameras"],
    queryFn: fetchCameras,
  });

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>WatchingEye</h1>
      <p>Deterministic edge vision platform — every decision explained.</p>
      <h2>Cameras</h2>
      {isLoading && <p>Loading…</p>}
      {error instanceof Error && <p role="alert">Gateway unreachable: {error.message}</p>}
      {data && data.cameras.length === 0 && <p>No cameras registered yet.</p>}
      <ul>
        {data?.cameras.map((c) => (
          <li key={c.id}>
            {c.id} ({c.kind}) — {c.location}
          </li>
        ))}
      </ul>
    </main>
  );
}
