import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { clearHistory, deleteHistory, getHistory, historyAvailable, listHistory, recordGame, resetStoreForTests, saveHistory } from "./store";
import { substanceKeyOf } from "./record";
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
    await recordGame(record("a", { depth: 18, data: "deeper" }), 3000);
    expect(await getHistory("a")).toMatchObject({ depth: 18, reviewedAt: 3000 });
  });

  it("does without the database", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetStoreForTests();
    expect(await historyAvailable()).toBe(false);
    expect(await listHistory()).toEqual([]);
    expect(await getHistory("a")).toBeNull();
    expect(await saveHistory(record("a"))).toBe(false);
    await expect(recordGame(record("a"))).resolves.toBeUndefined();
    await expect(deleteHistory("a")).resolves.toBeUndefined();
    await expect(clearHistory()).resolves.toBeUndefined();
  });

  it("says so when the browser has IndexedDB but refuses it", async () => {
    // A private window's open() throws; refused site data errors instead.
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked");
      },
    });
    resetStoreForTests();
    expect(await historyAvailable()).toBe(false);
    expect(await saveHistory(record("a"))).toBe(false);

    vi.stubGlobal("indexedDB", {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        queueMicrotask(() => req.onerror?.(new Event("error") as Event));
        return req;
      },
    });
    resetStoreForTests();
    expect(await historyAvailable()).toBe(false);
    expect(await listHistory()).toEqual([]);
  });

  it("asks the database whether it can keep a history", async () => {
    expect(await historyAvailable()).toBe(true);
  });

  it("keeps one record for the same game from two sources", async () => {
    // Chess.com's API writes its own headers; the extension's page writes others for the same moves.
    const apiPgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.12"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n`;
    const pagePgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.13"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n[Termination "Ada won by resignation"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n`;
    const from = async (id: string, pgn: string): Promise<HistoryRecord> =>
      record(id, { pgn, key: await substanceKeyOf(pgn), depth: 12, data: "packed", reviewedAt: 1000 });

    await recordGame(await from("api", apiPgn), 1000);
    await recordGame(await from("page", pagePgn), 5000);

    const all = await listHistory();
    expect(all).toHaveLength(1);
    // The row keeps the id it was first saved with, and the visit is noted.
    expect(all[0].id).toBe("api");
    expect(all[0].lastOpenedAt).toBe(5000);
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
