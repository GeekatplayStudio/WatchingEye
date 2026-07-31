/**
 * ANPR (Automatic Number Plate Recognition) helper.
 *
 * Extracts license plate text patterns from snapshot descriptions, OCR passes, or image region metadata.
 */

export interface LicensePlateResult {
  plateText: string;
  confidence: number;
  region?: string;
  confirmed: boolean;
}

export function extractLicensePlate(text: string): LicensePlateResult | null {
  if (!text) return null;
  // Match license plate formats containing letters and digits (e.g. ABC-1234, 7XYZ-890, 1ABC234)
  const regex = /\b([A-Z]{1,4}[- ][0-9]{3,5}|[0-9][A-Z]{2,4}[- ][0-9]{3,4}|[A-Z]{3,4}[0-9]{3,4})\b/i;
  const match = regex.exec(text);
  if (!match || !match[1]) return null;

  let plateStr = match[1].toUpperCase();

  // If match has no hyphen but is 7 chars (3 letters + 4 digits)
  if (!plateStr.includes("-") && !plateStr.includes(" ")) {
    if (/^[A-Z]{3}[0-9]{4}$/.test(plateStr)) {
      plateStr = `${plateStr.slice(0, 3)}-${plateStr.slice(3)}`;
    }
  }

  return {
    plateText: plateStr,
    confidence: 0.92,
    confirmed: true,
  };
}
