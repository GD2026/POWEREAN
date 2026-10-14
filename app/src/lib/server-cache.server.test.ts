import { beforeEach, describe, expect, it } from "vitest";

import { allowRequest, cacheGet, cachePut, resetServerCacheForTests } from "./server-cache.server";

beforeEach(() => resetServerCacheForTests());

describe("cache", () => {
  it("returns a value until it expires", () => {
    cachePut("a", { ok: 1 }, 1000, 0);
    expect(cacheGet("a", 999)).toEqual({ ok: 1 });
    expect(cacheGet("a", 1000)).toBeUndefined();
  });
});

describe("rate limit", () => {
  it("allows up to the limit per window, per client", () => {
    const results = [0, 1, 2, 3].map((t) => allowRequest("1.2.3.4", 3, 60_000, t));
    expect(results).toEqual([true, true, true, false]);
    expect(allowRequest("5.6.7.8", 3, 60_000, 10)).toBe(true);
    expect(allowRequest("1.2.3.4", 3, 60_000, 60_000)).toBe(true);
  });
});
