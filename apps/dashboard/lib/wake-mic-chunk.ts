/**
 * Browser MediaRecorder helpers for wake-gate audio chunks.
 */

export const WAKE_CHUNK_MS = 1_500;

/** Encode a Blob as base64 (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Record one fixed-length chunk from an open mic stream. */
export async function recordWakeChunk(
  stream: MediaStream,
  durationMs = WAKE_CHUNK_MS,
): Promise<Blob> {
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
  });
  rec.start();
  await new Promise((r) => setTimeout(r, durationMs));
  if (rec.state !== "inactive") rec.stop();
  return done;
}
