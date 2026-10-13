// Pure EAN/GTIN helpers shared by the client (scanner, barcode rendering) and
// the server (input validation). No browser or Worker globals here.

export type BarcodeFormat = "EAN13" | "EAN8" | "UPC" | "CODE128";

const GS1_LENGTHS = new Set([8, 12, 13, 14]);

/** GS1 mod-10 check digit for a code body (everything except the last digit). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // Weights alternate 3,1,3,1… starting from the digit next to the check digit.
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || !GS1_LENGTHS.has(code.length)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * Normalises user or scanner input to a bare digit string of 8–14 digits, or
 * null. A valid 12-digit UPC-A becomes its 13-digit EAN form (leading 0), the
 * same value camera readers report, so one product never appears twice. A bad
 * check digit is allowed through on purpose: in-store labels and damaged
 * prints exist, and the code still has to reach the internal system.
 */
export function normalizeEan(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(digits)) return null;
  return digits.length === 12 && hasValidCheckDigit(digits) ? `0${digits}` : digits;
}

/** The symbology JsBarcode should draw so a store scanner reads the same digits back. */
export function barcodeFormatFor(code: string): BarcodeFormat {
  if (hasValidCheckDigit(code)) {
    if (code.length === 13) return "EAN13";
    if (code.length === 8) return "EAN8";
    if (code.length === 12) return "UPC";
  }
  return "CODE128";
}

/** Splits pasted text into unique normalised EANs, keeping the tokens it could not use. */
export function parseEanList(text: string): { eans: string[]; rejected: string[] } {
  const eans: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const ean = normalizeEan(token);
    if (!ean) {
      rejected.push(token);
    } else if (!seen.has(ean)) {
      seen.add(ean);
      eans.push(ean);
    }
  }
  return { eans, rejected };
}
