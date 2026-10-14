import { describe, expect, it, vi } from "vitest";

import searchAirpods from "./__fixtures__/search-airpods.json";
import searchEmpty from "./__fixtures__/search-empty.json";
import storesAirpods from "./__fixtures__/stores-airpods.json";
import { MARIERO, lookupPowerProduct, searchPowerProducts, toProductInfo } from "./power.server";

describe("toProductInfo", () => {
  it("normalises a search hit plus the Mariero store row", () => {
    const info = toProductInfo("195950543650", searchAirpods.products[0], storesAirpods);
    expect(info).toMatchObject({
      ean: "195950543650",
      productId: 4157161,
      title: "Apple AirPods Pro 3",
      brand: "Apple",
      price: 2890,
      previousPrice: null,
      productUrl:
        "https://www.power.no/tv-og-lyd/hodetelefoner/true-wireless-hodetelefoner/apple-airpods-pro-3/p-4157161/",
      stock: {
        webCount: 4763,
        allStoresCount: 1867,
        store: {
          id: 1690,
          name: "POWER Mariero",
          availability: "in_stock",
          onDisplay: false,
          exactCount: null,
        },
      },
    });
    expect(info.imageUrl).toMatch(
      /^https:\/\/media\.power-cdn\.net\/images\/.+\/4157161_9_600x600_w_g\.jpg$/,
    );
    expect(info.thumbUrl).toMatch(/_150x150_w_g\.jpg$/);
    expect(info.stock.webText).toBe("På nettlager (100+)");
  });

  it("returns a null store when Mariero is missing from the store list", () => {
    const others = storesAirpods.filter((s) => s.storeId !== MARIERO.storeId);
    const info = toProductInfo("195950543650", searchAirpods.products[0], others);
    expect(info.stock.store).toBeNull();
  });

  it("maps every store availability code and reads an exact count when POWER sends one", () => {
    const row = {
      ...storesAirpods[0],
      storeAvailability: 4,
      storeDisplayStock: 1,
      storeStockCount: 3,
    };
    const info = toProductInfo("195950543650", searchAirpods.products[0], [row]);
    expect(info.stock.store).toMatchObject({
      availability: "order_to_store",
      onDisplay: true,
      exactCount: 3,
    });
  });
});

describe("lookupPowerProduct", () => {
  function fakeFetch(routes: Record<string, unknown>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const key = url.pathname;
      if (!(key in routes)) return new Response("not found", { status: 404 });
      return Response.json(routes[key]);
    });
  }

  it("finds the product and its Mariero stock", async () => {
    const fetchImpl = fakeFetch({
      "/api/v2/productlists": searchAirpods,
      "/api/v2/products/4157161/stores": storesAirpods,
    });
    const result = await lookupPowerProduct("195950543650", fetchImpl);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.product.stock.store?.availability).toBe("in_stock");
    }
    const searchUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(searchUrl.origin).toBe("https://www.power.no");
    expect(searchUrl.searchParams.get("q")).toBe("0195950543650");
  });

  it("reports not_found for an EAN power.no does not know", async () => {
    const fetchImpl = fakeFetch({ "/api/v2/productlists": searchEmpty });
    expect(await lookupPowerProduct("0000000000000", fetchImpl)).toEqual({
      status: "not_found",
      ean: "0000000000000",
    });
  });

  it("still returns the product when only the store lookup fails", async () => {
    const fetchImpl = fakeFetch({ "/api/v2/productlists": searchAirpods });
    const result = await lookupPowerProduct("195950543650", fetchImpl);
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.product.stock.store).toBeNull();
  });

  it("reports an error when power.no is down", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    const result = await lookupPowerProduct("195950543650", fetchImpl);
    expect(result).toMatchObject({ status: "error", ean: "0195950543650" });
  });

  it("refuses input that is not an EAN without calling power.no", async () => {
    const fetchImpl = vi.fn();
    const result = await lookupPowerProduct("../../etc", fetchImpl);
    expect(result.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("searchPowerProducts", () => {
  const airpods = searchAirpods.products[0];
  const phone = (id: number, title: string) => ({ ...airpods, productId: id, title });

  function router(handler: (url: URL) => unknown) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = handler(url);
      return body === undefined ? new Response("nope", { status: 404 }) : Response.json(body);
    });
  }

  it("fetches a POWER article number directly", async () => {
    const fetchImpl = router((url) => {
      if (url.pathname === "/api/v2/products" && url.searchParams.get("ids") === "4157161")
        return [airpods];
      if (url.pathname === "/api/v2/products/4157161/stores") return storesAirpods;
    });
    const result = await searchPowerProducts("4157161", fetchImpl);
    expect(result).toMatchObject({ status: "found", total: 1 });
    if (result.status === "found") {
      expect(result.products[0]).toMatchObject({ productId: 4157161, ean: null });
      expect(result.products[0].stock.store?.availability).toBe("in_stock");
    }
  });

  it("drops words until power.no finds something, then ranks by the tag text", async () => {
    const queries: string[] = [];
    const fetchImpl = router((url) => {
      if (url.pathname === "/api/v2/productlists") {
        const q = url.searchParams.get("q")!;
        queries.push(q);
        return q === "iphone 17 pro max 512"
          ? {
              products: [
                phone(1, "Apple iPhone 17 Pro Max 512 GB, sølv"),
                phone(2, "Apple iPhone 17 Pro Max 512 GB, svart"),
              ],
            }
          : { products: [] };
      }
      if (/\/stores$/.test(url.pathname)) return storesAirpods;
    });
    const result = await searchPowerProducts("iPhone 17 Pro Max 512GB (Sort)", fetchImpl);
    expect(queries).toEqual(["iphone 17 pro max 512 GB", "iphone 17 pro max 512"]);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.query).toBe("iphone 17 pro max 512");
      expect(result.products.map((p) => p.productId)).toEqual([2, 1]);
    }
  });

  it("reports not_found when nothing matches", async () => {
    const fetchImpl = router((url) =>
      url.pathname === "/api/v2/productlists" ? { products: [] } : undefined,
    );
    expect(await searchPowerProducts("finnes ikke modell", fetchImpl)).toMatchObject({
      status: "not_found",
    });
  });

  it("reports an error when power.no is down", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await searchPowerProducts("LG G6 OLED", fetchImpl)).toMatchObject({ status: "error" });
  });
});
