import { describe, expect, it } from "vitest";

import {
  buildSearchQueries,
  cleanSearchText,
  extractTagCandidates,
  rankByText,
} from "./search-text";

describe("cleanSearchText", () => {
  it("splits storage units the way power.no writes them and drops colours", () => {
    expect(cleanSearchText("Iphone 17 pro max 512gb (Sort)")).toBe("iphone 17 pro max 512 GB");
  });
  it("drops prices and label boilerplate", () => {
    expect(cleanSearchText("LG G6 OLED TV  Før 29 990,-  Nå 24 990,- inkl. mva")).toBe(
      "lg g6 oled tv",
    );
  });
});

describe("buildSearchQueries", () => {
  it("retries with fewer words when the full line finds nothing", () => {
    expect(buildSearchQueries("Apple iPhone 17 Pro Max 512GB Sort")).toEqual([
      "apple iphone 17 pro max 512 GB",
      "apple iphone 17 pro max 512",
      "apple iphone 17 pro max",
      "apple iphone 17 pro",
    ]);
  });
  it("returns nothing for text with no searchable words", () => {
    expect(buildSearchQueries("Pris 999,-")).toEqual([]);
  });
});

describe("rankByText", () => {
  it("puts the product above accessories and honours the colour on the tag", () => {
    const hits = [
      { title: "PanzerGlass CARE 3-i-1 personvernpakke iPhone 17 Pro Max, Matt" },
      { title: "Apple iPhone 17 Pro Max 512 GB, sølv" },
      { title: "Apple iPhone 17 Pro Max 512 GB, svart" },
    ];
    expect(rankByText(hits, "iPhone 17 Pro Max 512GB (Sort)")[0].title).toBe(
      "Apple iPhone 17 Pro Max 512 GB, svart",
    );
  });
});

describe("extractTagCandidates", () => {
  it("reads article number, EAN, model code and name from a shelf label", () => {
    const tag = [
      'LG 65" OLED evo G6 4K TV',
      "OLED65G64LW",
      "Varenr. 4279577",
      "8806096123456",
      "24 990,-",
    ].join("\n");
    const kinds = extractTagCandidates(tag).map((c) => [c.kind, c.value]);
    expect(kinds).toContainEqual(["varenr", "4279577"]);
    expect(kinds).toContainEqual(["modell", "OLED65G64LW"]);
    expect(kinds).toContainEqual(["navn", 'lg 65" oled evo g6 4k tv']);
    expect(kinds.some(([k]) => k === "ean")).toBe(false); // bad check digit
    // Lone codes are not repeated as names.
    expect(kinds.filter(([k]) => k === "navn")).toEqual([["navn", 'lg 65" oled evo g6 4k tv']]);
  });

  it("recognises a valid EAN and ignores prices", () => {
    const kinds = extractTagCandidates("AirPods Pro 3\n0195950543650\n2 890,-").map((c) => c.kind);
    expect(kinds[0]).toBe("ean");
    expect(kinds).not.toContain("varenr");
  });

  it("does not mistake storage sizes for model codes", () => {
    const values = extractTagCandidates("iPhone 17 Pro Max 512GB").map((c) => c.value);
    expect(values).not.toContain("512GB");
  });
});
