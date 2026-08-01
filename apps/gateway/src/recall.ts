/**
 * Grounded natural-language recall over the dataset store.
 *
 * Gateway stays AI-free: multi-term keyword scoring + a deterministic
 * template answer. Citations must be subset of retrieved ids (same contract
 * as orchestrator `verifyGrounded`). No text-embedding model here — DINOv2
 * appearance search remains `/api/dataset/similar`.
 */
import type { DatasetRecord } from "./dataset.js";

/** One evidence quote pulled from a retrieved record. */
export interface EvidenceQuote {
  recordId: string;
  label: string;
  text: string;
}

/** Grounded recall payload for the dashboard. */
export interface GroundedRecall {
  answer: string;
  citations: string[];
  records: DatasetRecord[];
  evidenceQuotes: EvidenceQuote[];
  /** Query after stripping time tokens. */
  query: string;
  since?: string;
  until?: string;
}

/** Why a recall answer failed grounding. */
export class GroundingError extends Error {
  constructor(readonly unknownCitations: string[]) {
    super(`answer cites records that were not retrieved: ${unknownCitations.join(", ")}`);
    this.name = "GroundingError";
  }
}

export interface TimeWindow {
  since?: string;
  until?: string;
  cleanedQuery: string;
}

/**
 * Pull relative day tokens out of a recall query.
 *
 * @example
 * parseTimeWindow("golden retriever yesterday", new Date("2026-08-01T15:00:00Z"))
 */
export function parseTimeWindow(query: string, now = new Date()): TimeWindow {
  const lower = query.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let since: string | undefined;
  let until: string | undefined;

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x;
  };

  for (const t of tokens) {
    if (t === "yesterday") {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - 1);
      since = startOfDay(day).toISOString();
      until = endOfDay(day).toISOString();
      continue;
    }
    if (t === "today") {
      since = startOfDay(now).toISOString();
      until = endOfDay(now).toISOString();
      continue;
    }
    kept.push(t);
  }

  return { since, until, cleanedQuery: kept.join(" ").trim() };
}

/** Terms longer than 2 chars, lowercased. */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

function recordHaystack(r: DatasetRecord): string {
  return [
    r.class,
    r.cameraId,
    r.objectId,
    r.licensePlate ?? "",
    r.breedOrModel ?? "",
    ...(r.descriptors ?? []).flatMap((d) => [d.key, d.value]),
    ...r.evidence.flatMap((e) => [e.label, e.description]),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Score by distinct query-term hits (KeywordRetriever contract).
 *
 * @example
 * scoreRecord(record, ["golden", "retriever"])
 */
export function scoreRecord(record: DatasetRecord, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = recordHaystack(record);
  return new Set(terms.filter((t) => haystack.includes(t))).size;
}

export function inTimeWindow(
  record: DatasetRecord,
  since?: string,
  until?: string,
): boolean {
  const t = Date.parse(record.timestamp);
  if (Number.isNaN(t)) return false;
  if (since !== undefined && t < Date.parse(since)) return false;
  if (until !== undefined && t > Date.parse(until)) return false;
  return true;
}

/**
 * Rank records for a recall query (optional time window already parsed).
 */
export function rankRecords(
  records: DatasetRecord[],
  cleanedQuery: string,
  limit: number,
  since?: string,
  until?: string,
): DatasetRecord[] {
  const terms = queryTerms(cleanedQuery);
  const windowed = records.filter((r) => inTimeWindow(r, since, until));
  if (terms.length === 0) {
    return [...windowed]
      .sort(
        (a, b) =>
          Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id),
      )
      .slice(0, limit);
  }
  const scored = windowed
    .map((record) => ({ record, score: scoreRecord(record, terms) }))
    .filter((s) => s.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(b.record.timestamp) - Date.parse(a.record.timestamp) ||
      a.record.id.localeCompare(b.record.id),
  );
  return scored.slice(0, limit).map((s) => s.record);
}

/**
 * Reject answers that cite ids outside the retrieved set.
 *
 * @throws {GroundingError}
 */
export function verifyGrounded(
  answer: { answer: string; citations: string[] },
  retrieved: DatasetRecord[],
): { answer: string; citations: string[] } {
  const allowed = new Set(retrieved.map((r) => r.id));
  const unknown = answer.citations.filter((c) => !allowed.has(c));
  if (unknown.length > 0) throw new GroundingError(unknown);
  return answer;
}

function summarize(record: DatasetRecord): string {
  const bits = [record.class, `@ ${record.cameraId}`];
  if (record.licensePlate !== undefined) bits.push(`plate ${record.licensePlate}`);
  if (record.breedOrModel !== undefined) bits.push(record.breedOrModel);
  return bits.join(" ");
}

/**
 * Build a template grounded answer from ranked records (no LLM).
 *
 * @example
 * buildGroundedRecall(hits, "ABC-1234")
 */
export function buildGroundedRecall(
  records: DatasetRecord[],
  query: string,
  since?: string,
  until?: string,
): GroundedRecall {
  const citations = records.map((r) => r.id);
  const evidenceQuotes: EvidenceQuote[] = [];
  for (const r of records) {
    for (const e of r.evidence) {
      evidenceQuotes.push({
        recordId: r.id,
        label: e.label,
        text: e.description,
      });
    }
    if (r.licensePlate !== undefined) {
      evidenceQuotes.push({
        recordId: r.id,
        label: `plate:${r.licensePlate}`,
        text: `Stored license plate ${r.licensePlate}`,
      });
    }
    if (r.breedOrModel !== undefined) {
      evidenceQuotes.push({
        recordId: r.id,
        label: "breed_or_model",
        text: r.breedOrModel,
      });
    }
  }

  let answer: string;
  if (records.length === 0) {
    answer = `No matching dataset records for "${query}".`;
  } else {
    const tops = records
      .slice(0, 3)
      .map((r) => `[${r.id}] ${summarize(r)}`)
      .join("; ");
    answer = `Found ${records.length} record(s) for "${query}". ${tops}.`;
  }

  const grounded = verifyGrounded({ answer, citations }, records);
  const out: GroundedRecall = {
    answer: grounded.answer,
    citations: grounded.citations,
    records,
    evidenceQuotes: evidenceQuotes.slice(0, 40),
    query,
  };
  if (since !== undefined) out.since = since;
  if (until !== undefined) out.until = until;
  return out;
}

/**
 * End-to-end recall: parse time tokens → rank → optionally union text-NN and
 * CLIP-NN → grounded template.
 */
export function recallFromRecords(
  all: DatasetRecord[],
  rawQuery: string,
  limit = 20,
  now = new Date(),
  textHits: DatasetRecord[] = [],
  clipHits: DatasetRecord[] = [],
): GroundedRecall {
  const { since, until, cleanedQuery } = parseTimeWindow(rawQuery, now);
  const q = cleanedQuery === "" ? rawQuery.trim() : cleanedQuery;
  const ranked = rankRecords(all, q, limit, since, until);
  const seen = new Set(ranked.map((r) => r.id));
  const merged = [...ranked];
  for (const hit of [...textHits, ...clipHits]) {
    if (seen.has(hit.id)) continue;
    if (!inTimeWindow(hit, since, until)) continue;
    seen.add(hit.id);
    merged.push(hit);
    if (merged.length >= limit) break;
  }
  return buildGroundedRecall(merged, q || rawQuery.trim(), since, until);
}
