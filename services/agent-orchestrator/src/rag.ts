/**
 * Retrieval over event history.
 *
 * RAG here is grounding, not generation: retrieved records are attached to
 * the answer as citable evidence, and an answer may only reference records
 * that were actually retrieved. `verifyGrounded` enforces that — an answer
 * citing an id that was never retrieved is rejected outright.
 *
 * The vector store is optional by design (PRD: "Vector DB optional. Never
 * required."). `KeywordRetriever` provides the always-available fallback.
 */
import { z } from "zod";

/** One retrievable event record. */
export const EventRecordSchema = z.object({
  id: z.string().min(1),
  objectClass: z.string().min(1),
  cameraId: z.string().min(1),
  timestamp: z.string(),
  summary: z.string(),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

/** A grounded answer: prose plus the exact records backing it. */
export const GroundedAnswerSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(z.string().min(1)).min(1),
});

export type GroundedAnswer = z.infer<typeof GroundedAnswerSchema>;

/** Retrieval backend. */
export interface Retriever {
  retrieve(query: string, limit: number): Promise<EventRecord[]>;
}

/** Why an answer failed grounding verification. */
export class GroundingError extends Error {
  constructor(readonly unknownCitations: string[]) {
    super(`answer cites records that were not retrieved: ${unknownCitations.join(", ")}`);
    this.name = "GroundingError";
  }
}

/**
 * Deterministic keyword retriever — the required-path fallback that works
 * with no vector database. Scores by distinct query-term matches, ties
 * broken by recency so results are stable.
 */
export class KeywordRetriever implements Retriever {
  constructor(private readonly records: EventRecord[]) {}

  async retrieve(query: string, limit: number): Promise<EventRecord[]> {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const scored = this.records
      .map((record) => {
        const haystack =
          `${record.objectClass} ${record.cameraId} ${record.summary}`.toLowerCase();
        const score = new Set(terms.filter((t) => haystack.includes(t))).size;
        return { record, score };
      })
      .filter((s) => s.score > 0);

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.record.timestamp) - Date.parse(a.record.timestamp) ||
        a.record.id.localeCompare(b.record.id),
    );
    return scored.slice(0, limit).map((s) => s.record);
  }
}

/**
 * Reject any answer citing records outside the retrieved set.
 *
 * This is the anti-hallucination gate for question answering: the model may
 * only speak about what retrieval actually returned.
 *
 * @throws {GroundingError} when a citation is not in `retrieved`.
 */
export function verifyGrounded(
  answer: GroundedAnswer,
  retrieved: EventRecord[],
): GroundedAnswer {
  const allowed = new Set(retrieved.map((r) => r.id));
  const unknown = answer.citations.filter((c) => !allowed.has(c));
  if (unknown.length > 0) {
    throw new GroundingError(unknown);
  }
  return answer;
}

/** Build the context block handed to the model. Ids are explicit so the
 *  model can cite them and we can verify the citations. */
export function buildContext(records: EventRecord[]): string {
  if (records.length === 0) {
    return "No matching events.";
  }
  return records
    .map((r) => `[${r.id}] ${r.timestamp} ${r.objectClass} @ ${r.cameraId}: ${r.summary}`)
    .join("\n");
}
