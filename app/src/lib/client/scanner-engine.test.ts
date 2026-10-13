import { describe, expect, it, vi } from "vitest";

vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/zxing_reader.wasm" }));

const { ReadConfirmer } = await import("./scanner-engine");

describe("ReadConfirmer", () => {
  it("needs two identical reads within the window", () => {
    const c = new ReadConfirmer(1500, 3000);
    expect(c.offer("5901234123457", 0)).toBeNull();
    expect(c.offer("5901234123457", 200)).toBe("5901234123457");
  });

  it("does not confirm two reads that are too far apart", () => {
    const c = new ReadConfirmer(1500, 3000);
    expect(c.offer("5901234123457", 0)).toBeNull();
    expect(c.offer("5901234123457", 2000)).toBeNull();
    expect(c.offer("5901234123457", 2100)).toBe("5901234123457");
  });

  it("does not confirm when a different code appears in between", () => {
    const c = new ReadConfirmer();
    c.offer("5901234123457", 0);
    c.offer("96385074", 100);
    expect(c.offer("5901234123457", 200)).toBeNull();
  });

  it("ignores the same code while it stays in view, then allows it again", () => {
    const c = new ReadConfirmer(1500, 3000);
    c.offer("5901234123457", 0);
    c.offer("5901234123457", 100);
    expect(c.offer("5901234123457", 1000)).toBeNull();
    expect(c.offer("5901234123457", 3500)).toBeNull(); // cooldown extended while in view
    expect(c.offer("5901234123457", 7000)).toBeNull(); // first read after cooldown
    expect(c.offer("5901234123457", 7100)).toBe("5901234123457");
  });

  it("lets a different code through right after an accepted one", () => {
    const c = new ReadConfirmer();
    c.offer("5901234123457", 0);
    c.offer("5901234123457", 100);
    c.offer("96385074", 150);
    expect(c.offer("96385074", 250)).toBe("96385074");
  });

  it("ignores values that are not EANs", () => {
    const c = new ReadConfirmer();
    expect(c.offer("hello", 0)).toBeNull();
    expect(c.offer("hello", 10)).toBeNull();
  });
});
