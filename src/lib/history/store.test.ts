import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { clearHistory, deleteHistory, getHistory, isHistoryAvailable, listHistory, recordGame, resetStoreForTests, saveHistory } from "./store";
import type { HistoryRecord } from "./types";

const record = (id: string, overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
  v: 1,
  id,
  pgn: `[White "A"]\n[Black "B"]\n\n1. e4 e5 *\n`,
  depth: 14,
  reviewedAt: 1000,
  lastOpenedAt: 1000,
  summary: {
    white: "A",
    black: "B",
    result: "*",
    opening: null,
    plies: 2,
    accuracy: { w: null, b: null },
    counts: {},
  },
  ...overrides,
});

/** A fresh database per test, as a private window would hand out. */
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  resetStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetStoreForTests();
});

describe("the history's database", () => {
  it("keeps, lists, deletes and clears", async () => {
    await saveHistory(record("b", { reviewedAt: 2000 }));
    await saveHistory(record("a", { reviewedAt: 1000 }));
    expect((await listHistory()).map((r) => r.id)).toEqual(["b", "a"]);
    expect(await getHistory("a")).toMatchObject({ id: "a" });
    expect(await getHistory("missing")).toBeNull();
    await deleteHistory("a");
    expect(await getHistory("a")).toBeNull();
    await clearHistory();
    expect(await listHistory()).toEqual([]);
    expect(await listHistory()).toEqual([]); // and again, after the clear
  });

  it("keeps a new review of a game under the record's rules", async () => {
    await recordGame(record("a", { data: "packed" }), 1000);
    await recordGame(record("a", { data: "packed" }), 2000);
    expect(await getHistory("a")).toMatchObject({ reviewedAt: 1000, lastOpenedAt: 2000 });
    await recordGame(record("a", { depth: 18 }), 3000);
    expect(await getHistory("a")).toMatchObject({ depth: 18, reviewedAt: 3000 });
  });

  it("does without the database", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetStoreForTests();
    expect(isHistoryAvailable()).toBe(false);
    expect(await listHistory()).toEqual([]);
    expect(await getHistory("a")).toBeNull();
    expect(await saveHistory(record("a"))).toBe(false);
    await expect(recordGame(record("a"))).resolves.toBeUndefined();
    await expect(deleteHistory("a")).resolves.toBeUndefined();
    await expect(clearHistory()).resolves.toBeUndefined();
  });

  it("ignores records that no longer look like records", async () => {
    const req = indexedDB.open("wtp-history", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("games", { keyPath: "id" });
    await new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
    });
    const tx = req.result.transaction("games", "readwrite");
    tx.objectStore("games").put({ id: "junk", pgn: 3, depth: "x", summary: null });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    req.result.close();
    resetStoreForTests();
    expect(await listHistory()).toEqual([]);
    expect(await getHistory("junk")).toBeNull();
  });
});
