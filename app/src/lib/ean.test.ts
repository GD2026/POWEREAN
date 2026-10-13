import { describe, expect, it } from "vitest";

import {
  barcodeFormatFor,
  gs1CheckDigit,
  hasValidCheckDigit,
  normalizeEan,
  parseEanList,
} from "./ean";

describe("gs1CheckDigit", () => {
  it("computes EAN-13 check digits", () => {
    expect(gs1CheckDigit("590123412345")).toBe(7); // 5901234123457
    expect(gs1CheckDigit("019595054365")).toBe(0); // 0195950543650 (AirPods Pro 3)
  });
  it("computes EAN-8 check digits", () => {
    expect(gs1CheckDigit("9638507")).toBe(4); // 96385074
  });
});

describe("hasValidCheckDigit", () => {
  it("accepts valid codes of every GS1 length", () => {
    expect(hasValidCheckDigit("5901234123457")).toBe(true);
    expect(hasValidCheckDigit("96385074")).toBe(true);
    expect(hasValidCheckDigit("195950543650")).toBe(true); // UPC-A
    expect(hasValidCheckDigit("10195950543657")).toBe(true); // GTIN-14
  });
  it("rejects a wrong check digit", () => {
    expect(hasValidCheckDigit("5901234123458")).toBe(false);
  });
  it("rejects non-GS1 lengths and non-digits", () => {
    expect(hasValidCheckDigit("12345")).toBe(false);
    expect(hasValidCheckDigit("59012341234a7")).toBe(false);
  });
});

describe("normalizeEan", () => {
  it("strips whitespace and dashes", () => {
    expect(normalizeEan(" 5901 2341-23457 ")).toBe("5901234123457");
  });
  it("returns null for input that is not 8-14 digits", () => {
    expect(normalizeEan("abc")).toBeNull();
    expect(normalizeEan("1234567")).toBeNull();
    expect(normalizeEan("123456789012345")).toBeNull();
    expect(normalizeEan("")).toBeNull();
  });
  it("keeps codes with a bad check digit (shop labels exist) but they stay digits", () => {
    expect(normalizeEan("5901234123458")).toBe("5901234123458");
  });
  it("turns a valid UPC-A into its EAN-13 form so camera and typed codes match", () => {
    expect(normalizeEan("195950543650")).toBe("0195950543650");
    expect(normalizeEan("195950543651")).toBe("195950543651"); // invalid UPC stays as typed
  });
});

describe("barcodeFormatFor", () => {
  it("picks the GS1 symbology for valid codes", () => {
    expect(barcodeFormatFor("5901234123457")).toBe("EAN13");
    expect(barcodeFormatFor("96385074")).toBe("EAN8");
    expect(barcodeFormatFor("195950543650")).toBe("UPC");
  });
  it("falls back to CODE128 for anything a GS1 symbology cannot encode", () => {
    expect(barcodeFormatFor("5901234123458")).toBe("CODE128");
    expect(barcodeFormatFor("10195950543657")).toBe("CODE128");
  });
});

describe("parseEanList", () => {
  it("splits pasted text on any separator, normalises and de-duplicates", () => {
    const text = "5901234123457, 96385074\n195950543650;5901234123457\tfoo 123";
    expect(parseEanList(text)).toEqual({
      eans: ["5901234123457", "96385074", "0195950543650"],
      rejected: ["foo", "123"],
    });
  });
});
