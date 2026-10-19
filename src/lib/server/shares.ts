import "server-only";

/**
 * Shared reviews behind /r/[id]: made only when someone presses "Share" on a finished review,
 * which is the one time a game is stored. Each is kept for a year on the project's Upstash
 * Redis (the usage counter's database), under "share:{id}" in production and
 * "share-preview:" / "share-local:" elsewhere. The id comes from the content, so sharing the
 * same review twice gives the same link.
 */
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Color } from "../chess/types";
import type { ShareSummary } from "../review/shareCard";

export interface SharedReview {
  v: 1;
  pgn: string;
  as: Color;
  depth: number;
  /** The finished review, packed (src/lib/review/share.ts `packReview`). */
  data: string;
  summary: ShareSummary;
  /** When it was shared, ms since 1970. */
  at: number;
}

/** The commands shares need (a fake one in tests). */
export interface ShareDb {
  set(key: string, value: string, opts: { ex: number; nx: true }): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

const YEAR = 365 * 86_400;
const ID = /^[0-9A-Za-z]{10}$/;

let store: ShareDb | null | undefined;

/** The database, or null when it isn't connected (e.g. local development without the keys). */
export function shareStore(): ShareDb | null {
  if (store !== undefined) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? (new Redis({ url, token, automaticDeserialization: false }) as unknown as ShareDb) : null;
  return store;
}

const prefix = (env = process.env.VERCEL_ENV) => (env === "production" ? "share" : `share-${env || "local"}`);

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A short id from the shared content: 10 base-62 characters (about 59 bits) of its SHA-256. */
export function shareId(r: Pick<SharedReview, "pgn" | "as" | "depth" | "data">): string {
  const digest = createHash("sha256").update(`${r.pgn}\n${r.as}\n${r.depth}\n${r.data}`).digest();
  let n = digest.readBigUInt64BE(0);
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += BASE62[Number(n % 62n)];
    n /= 62n;
  }
  return id;
}

/** Stores a shared review (kept as it was if the same one is shared again) and returns its id. */
export async function saveShare(db: ShareDb, r: SharedReview, env?: string): Promise<string> {
  const id = shareId(r);
  await db.set(`${prefix(env)}:${id}`, JSON.stringify(r), { ex: YEAR, nx: true });
  return id;
}

/** A shared review by id, or null (unknown, expired, or not an id at all). */
export async function loadShare(db: ShareDb, id: string, env?: string): Promise<SharedReview | null> {
  if (!ID.test(id)) return null;
  const raw = await db.get(`${prefix(env)}:${id}`);
  if (typeof raw !== "string") return null;
  try {
    const r = JSON.parse(raw) as SharedReview;
    return r?.v === 1 && typeof r.pgn === "string" && typeof r.data === "string" && r.summary ? r : null;
  } catch {
    return null;
  }
}
