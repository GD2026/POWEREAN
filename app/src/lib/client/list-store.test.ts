import { describe, expect, it } from "vitest";

import {
  MAX_ITEMS_PER_LIST,
  MAX_LISTS,
  addItems,
  clearItems,
  createList,
  decodeShare,
  emptyStore,
  encodeShare,
  removeItem,
  renameList,
  setDone,
  storeSchema,
  upsertList,
} from "./list-store";

function fakeIds() {
  let n = 0;
  return { now: () => "2026-10-14T10:00:00.000Z", id: () => `id-${++n}` };
}

describe("list operations", () => {
  it("appends in order and refreshes duplicates instead of repeating them", () => {
    const ids = fakeIds();
    let list = createList("A", ids);
    list = addItems(
      list,
      [{ ean: "5901234123457" }, { ean: "96385074", title: "Kabel" }],
      ids,
    ).list;
    const second = addItems(
      list,
      [
        { ean: "195950543650", title: "AirPods" }, // UPC-A, stored as EAN-13
        { ean: "5901234123457", title: "Oppdatert" },
      ],
      ids,
    );
    expect(second).toMatchObject({ added: 1, updated: 1, full: false });
    expect(second.list.items.map((i) => [i.ean, i.title])).toEqual([
      ["5901234123457", "Oppdatert"],
      ["96385074", "Kabel"],
      ["0195950543650", "AirPods"],
    ]);
  });

  it("keeps the done state when an EAN is scanned again", () => {
    const ids = fakeIds();
    let list = addItems(createList("A", ids), [{ ean: "96385074" }], ids).list;
    list = setDone(list, list.items[0].id, true, ids);
    list = addItems(list, [{ ean: "96385074", title: "Ny tittel" }], ids).list;
    expect(list.items[0]).toMatchObject({ done: true, title: "Ny tittel" });
  });

  it("drops product links that do not point at POWER", () => {
    const ids = fakeIds();
    const { list } = addItems(
      createList("A", ids),
      [
        {
          ean: "96385074",
          thumbUrl: "javascript:alert(1)",
          productUrl: "https://evil.example/p",
        },
      ],
      ids,
    );
    expect(list.items[0]).toMatchObject({ thumbUrl: null, productUrl: null });
  });

  it("skips input that is not an EAN", () => {
    const ids = fakeIds();
    const result = addItems(createList("A", ids), [{ ean: "abc" }], ids);
    expect(result.added).toBe(0);
  });

  it("toggles, removes and clears only done items", () => {
    const ids = fakeIds();
    let list = addItems(
      createList("A", ids),
      [{ ean: "5901234123457" }, { ean: "96385074" }, { ean: "195950543650" }],
      ids,
    ).list;
    list = setDone(list, list.items[0].id, true, ids);
    list = removeItem(list, list.items[1].id, ids);
    expect(list.items.map((i) => [i.ean, i.done])).toEqual([
      ["5901234123457", true],
      ["0195950543650", false],
    ]);
    expect(clearItems(list, true, ids).items.map((i) => i.ean)).toEqual(["0195950543650"]);
    expect(clearItems(list, false, ids).items).toEqual([]);
  });

  it("stops adding at the list size limit", () => {
    const ids = fakeIds();
    const many = Array.from({ length: MAX_ITEMS_PER_LIST + 5 }, (_, i) => ({
      ean: String(10_000_000 + i),
    }));
    const result = addItems(createList("A", ids), many, ids);
    expect(result).toMatchObject({ added: MAX_ITEMS_PER_LIST, full: true });
  });

  it("ignores a blank rename", () => {
    const ids = fakeIds();
    const list = createList("A", ids);
    expect(renameList(list, "   ", ids).name).toBe("A");
    expect(renameList(list, " Lager ", ids).name).toBe("Lager");
  });
});

describe("store", () => {
  it("activates an upserted list and caps how many lists are kept", () => {
    const ids = fakeIds();
    let store = emptyStore;
    for (let i = 0; i < MAX_LISTS + 3; i++) store = upsertList(store, createList(`L${i}`, ids));
    expect(store.lists).toHaveLength(MAX_LISTS);
    expect(store.activeId).toBe(store.lists[0].id);
    expect(storeSchema.safeParse(store).success).toBe(true);
  });
});

describe("share links", () => {
  it("round-trips a list through a share payload", async () => {
    const ids = fakeIds();
    let list = addItems(
      createList("Varetelling", ids),
      [{ ean: "195950543650", title: "Apple AirPods Pro 3", price: 2890 }, { ean: "96385074" }],
      ids,
    ).list;
    list = setDone(list, list.items[1].id, true, ids);

    const payload = await encodeShare(list);
    expect(payload).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    const decoded = await decodeShare(payload, fakeIds());
    expect(decoded).toMatchObject({ id: list.id, name: "Varetelling" });
    expect(decoded?.items.map((i) => [i.ean, i.title, i.price, i.done])).toEqual([
      ["0195950543650", "Apple AirPods Pro 3", 2890, false],
      ["96385074", null, null, true],
    ]);
  });

  it("rejects tampered or foreign payloads", async () => {
    expect(await decodeShare("zAAAA")).toBeNull();
    expect(await decodeShare("xabc")).toBeNull();
    const bad = btoa(JSON.stringify({ v: 1, id: "a", n: "x", i: [["<script>", null, null, 0]] }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await decodeShare(`j${bad}`)).toBeNull();
  });
});
