/**
 * License-plate text extraction (regex ANPR helper).
 *
 * Keep in sync with `services/agent-orchestrator/src/anpr.ts` — pure string
 * matching, no model. Gateway uses this when `activeIntent.anprEnabled`.
 */

export interface LicensePlateResult {
  plateText: string;
  confidence: number;
  /** False when the match is weak — surface as `ocr_unconfirmed`. */
  confirmed: boolean;
}

const CONFIRM_FLOOR = 0.85;

/**
 * Extract a plate-like token from free text.
 *
 * @example
 * extractLicensePlate("plate ABC-1234 visible")?.plateText // "ABC-1234"
 */
export function extractLicensePlate(text: string): LicensePlateResult | null {
  if (!text) return null;
  const regex =
    /\b([A-Z]{1,4}[- ][0-9]{3,5}|[0-9][A-Z]{2,4}[- ][0-9]{3,4}|[A-Z]{3,4}[0-9]{3,4})\b/i;
  const match = regex.exec(text);
  if (!match?.[1]) return null;

  let plateStr = match[1].toUpperCase().replace(" ", "-");
  if (!plateStr.includes("-") && /^[A-Z]{3}[0-9]{4}$/.test(plateStr)) {
    plateStr = `${plateStr.slice(0, 3)}-${plateStr.slice(3)}`;
  }

  const confidence = plateStr.includes("-") ? 0.92 : 0.78;
  return {
    plateText: plateStr,
    confidence,
    confirmed: confidence >= CONFIRM_FLOOR,
  };
}
