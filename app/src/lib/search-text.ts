// Pure helpers for "Lagersjekk": turn messy price-tag text (OCR or typed) into
// power.no search queries, and pick the most useful bits of a photographed tag.
import { hasValidCheckDigit } from "./ean";

const COLORS = new Set([
  "sort",
  "svart",
  "hvit",
  "sølv",
  "solv",
  "grå",
  "gra",
  "blå",
  "bla",
  "rød",
  "rod",
  "grønn",
  "gronn",
  "gul",
  "gull",
  "rosa",
  "lilla",
  "oransje",
  "beige",
  "brun",
  "turkis",
  "dypblå",
  "black",
  "white",
  "silver",
  "grey",
  "gray",
  "blue",
  "red",
  "green",
  "yellow",
  "gold",
  "pink",
  "purple",
  "orange",
  "graphite",
  "midnight",
  "starlight",
  "titan",
  "titanium",
  "natur",
  "natural",
  "kosmisk",
  "cosmic",
  "deep",
  "space",
  "mint",
  "lavender",
  "sage",
]);

// Shelf-label boilerplate that never helps a product search.
const NOISE = new Set([
  "pris",
  "kr",
  "nok",
  "før",
  "for",
  "nå",
  "na",
  "spar",
  "tilbud",
  "kampanje",
  "inkl",
  "mva",
  "garanti",
  "power",
  "pr",
  "stk",
  "per",
  "mnd",
  "fra",
  "kun",
  "varenr",
  "varenummer",
  "art",
  "artnr",
  "artikkelnr",
  "ean",
  "modell",
  "model",
  "veil",
  "veiledende",
  "price",
  "utstilling",
  "utstillingsmodell",
  "demo",
  "outlet",
  "ord",
  "ordinær",
  "ordinaer",
]);

// Colour words as power.no spells them in titles ("Sort" on a tag = "svart" online).
const COLOR_SYNONYMS: Record<string, string[]> = {
  sort: ["svart", "black"],
  svart: ["sort", "black"],
  black: ["svart", "sort"],
  hvit: ["white"],
  white: ["hvit"],
  sølv: ["silver"],
  silver: ["sølv"],
  grå: ["grey", "gray"],
  blå: ["blue", "dypblå"],
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)\s*(gb|tb|mb)\b/g, "$1 $2")
    .split(/[^\p{L}\p{N}"+.\-/]+/u)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
}

function isPriceToken(word: string) {
  return /^\d{1,3}([ .]\d{3})*(,-?|,\d{2})?$/.test(word) && word.length <= 9 && /,/.test(word);
}

/** Cleans text into a search phrase: no colours, prices or label boilerplate. */
export function cleanSearchText(text: string): string {
  const kept = words(text.replace(/\b\d[\d .]*,-/g, " ")).filter(
    (w) => !COLORS.has(w) && !NOISE.has(w) && !isPriceToken(w),
  );
  return kept
    .join(" ")
    .replace(/\b(\d+) (gb|tb|mb)\b/g, (_, n: string, u: string) => `${n} ${u.toUpperCase()}`)
    .slice(0, 100)
    .trim();
}

/**
 * Queries to try in order. power.no's search needs every word to match, so a
 * long tag line is retried with words dropped from the end.
 */
export function buildSearchQueries(text: string): string[] {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return [];
  const parts = cleaned.split(" ");
  const queries = [cleaned];
  for (let n = parts.length - 1; n >= 2 && queries.length < 4; n--) {
    queries.push(parts.slice(0, n).join(" "));
  }
  return [...new Set(queries)];
}

/** Ranks search hits by how well their titles match what was on the tag. */
export function rankByText<T extends { title: string }>(items: T[], text: string): T[] {
  const wanted = new Set<string>();
  for (const w of words(text)) {
    if (NOISE.has(w)) continue;
    wanted.add(w);
    for (const syn of COLOR_SYNONYMS[w] ?? []) wanted.add(syn);
  }
  if (wanted.size === 0) return items;
  const scored = items.map((item, index) => {
    const titleWords = words(item.title);
    const hits = titleWords.filter((w) => wanted.has(w)).length;
    const extra = titleWords.length - hits;
    return { item, index, score: hits * 2 - extra * 0.25 };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

export type TagCandidate = {
  kind: "varenr" | "ean" | "modell" | "navn";
  value: string;
  label: string;
};

const MODEL_RE = /^(?=[A-Z0-9./-]*\d)(?=[A-Z0-9./-]*[A-Z])[A-Z0-9][A-Z0-9./-]{4,24}$/;

/**
 * Picks search candidates from OCR'd price-tag lines, best first:
 * POWER article numbers (7 digits), EANs, model codes, then name lines.
 */
export function extractTagCandidates(text: string): TagCandidate[] {
  const out: TagCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: TagCandidate) => {
    const key = `${c.kind}:${c.value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  const flat = text.replace(/[Oo](?=\d{6})/g, "0");

  for (const m of flat.matchAll(/(?<![\d,.])(\d[\d ]{6,16}\d)(?![\d,])/g)) {
    const digits = m[1].replace(/ /g, "");
    if (/^\d{8}$|^\d{12,14}$/.test(digits) && hasValidCheckDigit(digits)) {
      push({ kind: "ean", value: digits, label: `EAN ${digits}` });
    }
  }
  for (const m of flat.matchAll(/(?<![\d,.])(\d{7})(?![\d,])/g)) {
    push({ kind: "varenr", value: m[1], label: `Varenr ${m[1]}` });
  }
  for (const raw of flat.split(/\s+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/]+$/g, "").toUpperCase();
    if (MODEL_RE.test(token) && !/^\d+$/.test(token) && !/^\d+(GB|TB|MB|HZ|W|L)$/.test(token)) {
      push({ kind: "modell", value: token, label: `Modell ${token}` });
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => (l.match(/\p{L}/gu) ?? []).length >= 4);
  for (const line of lines) {
    // A name needs at least two words; lone codes are already listed above.
    const cleaned = cleanSearchText(line);
    if (cleaned.split(" ").length >= 2) push({ kind: "navn", value: cleaned, label: cleaned });
    if (out.filter((c) => c.kind === "navn").length >= 4) break;
  }
  return out;
}
