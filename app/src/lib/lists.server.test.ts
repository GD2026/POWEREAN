import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ITEMS_PER_LIST,
  addItems,
  allowRequest,
  clearItems,
  createList,
  deleteItem,
  getList,
  hashClientKey,
  setItemDone,
} from "./lists.server";

// Minimal D1 stand-in over node:sqlite, covering the calls lists.server uses.
function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        params = values;
        return stmt;
      },
      async first() {
        return (sqlite.prepare(sql).get(...(params as never[])) as unknown) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...(params as never[])) };
      },
      async run() {
        sqlite.prepare(sql).run(...(params as never[]));
        return { success: true };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
  } as unknown as D1Database;
}

describe("EAN lists", () => {
  let db: D1Database;
  beforeEach(() => {
    db = fakeD1();
  });

  it("creates a list with a UUID and reads it back empty", async () => {
    const list = await createList(db, "Varetelling");
    expect(list.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getList(db, list.id)).toMatchObject({ name: "Varetelling", items: [] });
  });

  it("returns null for an unknown list", async () => {
    expect(await getList(db, crypto.randomUUID())).toBeNull();
  });

  it("appends items in order and refreshes duplicates instead of repeating them", async () => {
    const { id } = await createList(db, "A");
    await addItems(db, id, [{ ean: "5901234123457" }, { ean: "96385074", title: "Kabel" }]);
    const second = await addItems(db, id, [
      { ean: "195950543650", title: "AirPods" },
      { ean: "5901234123457", title: "Oppdatert" },
    ]);
    expect(second).toEqual({ added: 1, updated: 1, full: false });
    const list = await getList(db, id);
    expect(list?.items.map((i) => [i.ean, i.title])).toEqual([
      ["5901234123457", "Oppdatert"],
      ["96385074", "Kabel"],
      ["195950543650", "AirPods"],
    ]);
  });

  it("toggles done, deletes and clears only done items", async () => {
    const { id } = await createList(db, "A");
    await addItems(db, id, [
      { ean: "5901234123457" },
      { ean: "96385074" },
      { ean: "195950543650" },
    ]);
    let items = (await getList(db, id))!.items;
    await setItemDone(db, id, items[0].id, true);
    await deleteItem(db, id, items[1].id);
    items = (await getList(db, id))!.items;
    expect(items.map((i) => [i.ean, i.done])).toEqual([
      ["5901234123457", true],
      ["195950543650", false],
    ]);
    await clearItems(db, id, true);
    expect((await getList(db, id))!.items.map((i) => i.ean)).toEqual(["195950543650"]);
  });

  it("never touches another list's items", async () => {
    const a = await createList(db, "A");
    const b = await createList(db, "B");
    await addItems(db, a.id, [{ ean: "5901234123457" }]);
    const itemA = (await getList(db, a.id))!.items[0];
    await deleteItem(db, b.id, itemA.id);
    await setItemDone(db, b.id, itemA.id, true);
    expect((await getList(db, a.id))!.items[0]).toMatchObject({ id: itemA.id, done: false });
  });

  it("stops adding at the list size limit", async () => {
    const { id } = await createList(db, "A");
    const many = Array.from({ length: MAX_ITEMS_PER_LIST + 5 }, (_, i) => ({
      ean: String(10_000_000 + i),
    }));
    const result = await addItems(db, id, many);
    expect(result).toEqual({ added: MAX_ITEMS_PER_LIST, updated: 0, full: true });
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window", async () => {
    const db = fakeD1();
    const key = await hashClientKey("203.0.113.9");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allowRequest(db, key, 3, 60));
    expect(results).toEqual([true, true, true, false]);
    expect(await allowRequest(db, await hashClientKey("198.51.100.1"), 3, 60)).toBe(true);
  });

  it("hashes IPs so raw addresses are never stored", async () => {
    const key = await hashClientKey("203.0.113.9");
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(key).not.toContain("203");
  });
});
