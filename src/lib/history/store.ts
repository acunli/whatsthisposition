/**
 * The history's database: the "games" store of the browser's IndexedDB under "wtp-history".
 * Nothing leaves the browser — the only way a record travels is the file the user exports
 * (transfer.ts). Every function here fails safe: a blocked store (a private window, site
 * data refused, the quota gone) resolves to a safe value, so a review is never broken or
 * delayed by the history.
 */
import { upsert } from "./record";
import type { HistoryRecord } from "./types";

const DB = "wtp-history";
const VERSION = 1;

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null when there is none (and there never will be this session). */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("games")) {
        const store = db.createObjectStore("games", { keyPath: "id" });
        store.createIndex("reviewedAt", "reviewedAt");
      }
    };
    req.onsuccess = () => {
      // Another tab upgrading the database: let it, rather than blocking it.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onblocked = () => resolve(null);
    req.onerror = () => resolve(null);
  });
  return opening;
}

const settle = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed"));
  });

/** Once the first game is kept, ask the browser to keep the site's data under pressure. */
let persisted = false;
const persist = () => {
  if (persisted) return;
  persisted = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    // No say in the matter: the export file is the real backup.
  }
};

/** The records, newest review first. */
export async function listHistory(): Promise<HistoryRecord[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const records = await settle(db.transaction("games", "readonly").objectStore("games").getAll());
    return records
      .filter(isRecord)
      .sort((a, b) => b.reviewedAt - a.reviewedAt || b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

/** The record of one game, or null. */
export async function getHistory(id: string): Promise<HistoryRecord | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const record = await settle(db.transaction("games", "readonly").objectStore("games").get(id));
    return record && isRecord(record) ? record : null;
  } catch {
    return null;
  }
}

/** Keeps a record (overwriting the one with its id). True when it landed. */
export async function saveHistory(record: HistoryRecord): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    await settle(db.transaction("games", "readwrite").objectStore("games").put(record));
    persist();
    return true;
  } catch {
    return false;
  }
}

/** Keeps a new review of a game under the record's rules (record.ts). */
export async function recordGame(incoming: HistoryRecord, now = Date.now()): Promise<void> {
  const existing = await getHistory(incoming.id);
  await saveHistory(upsert(existing, incoming, now));
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (db) await settle(db.transaction("games", "readwrite").objectStore("games").delete(id));
  } catch {
    // A deletion that didn't happen will be there next time; no need to bother anyone.
  }
}

export async function clearHistory(): Promise<void> {
  try {
    const db = await openDb();
    if (db) await settle(db.transaction("games", "readwrite").objectStore("games").clear());
  } catch {
    // As above: the list on the page is refreshed by whoever cleared.
  }
}

export async function countHistory(): Promise<number> {
  try {
    const db = await openDb();
    if (!db) return 0;
    return await settle(db.transaction("games", "readonly").objectStore("games").count());
  } catch {
    return 0;
  }
}

/** A new database for the tests (each test runs on its own factory). */
export function resetStoreForTests(): void {
  opening = null;
}

/** Whether the browser lets the site keep a history at all. */
export function isHistoryAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** IndexedDB hands back whatever was put in; records only count if they still look like records. */
function isRecord(value: unknown): value is HistoryRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.pgn === "string" && typeof r.depth === "number" && r.summary != null;
}
