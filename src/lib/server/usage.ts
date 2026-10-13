import "server-only";

/**
 * The usage counter behind /api/usage and /stats, on the project's Upstash Redis database
 * (Vercel Marketplace; KV_REST_API_URL / KV_REST_API_TOKEN). Per UTC day it keeps:
 *   {prefix}:{day}:seen          a HyperLogLog of the day's visitors (from visits)
 *   {prefix}:{day}:who:{event}   a HyperLogLog of the visitors who did that
 *   {prefix}:{day}:n             a hash of counts: "event", "event:source", "country:XX" (visits)
 * A visitor is a daily token, HMAC(secret, day + IP + browser), computed in memory and only
 * ever added to a HyperLogLog, which stores no members: IP addresses and the tokens themselves
 * are never stored, and a token can't be linked to the next day's. Production writes "use:…";
 * preview and local runs write "use-preview:…" / "use-local:…", so testing never inflates the
 * real numbers. Without the database, nothing is counted and /stats says so.
 */
import { createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";
import { USAGE_EVENTS, type UsageEvent } from "../usage";

/** The commands the counter needs, as Upstash's pipeline offers them (a fake one in tests). */
export interface UsagePipe {
  pfadd(key: string, member: string): UsagePipe;
  pfcount(key: string, ...keys: string[]): UsagePipe;
  hincrby(key: string, field: string, increment: number): UsagePipe;
  hgetall(key: string): UsagePipe;
  exec(): Promise<unknown[]>;
}
export interface UsageDb {
  pipeline(): UsagePipe;
}

let store: UsageDb | null | undefined;

/** The database, or null when it isn't connected (e.g. local development). */
export function usageStore(): UsageDb | null {
  if (store !== undefined) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? (new Redis({ url, token, automaticDeserialization: false }) as unknown as UsageDb) : null;
  return store;
}

/** Keys per deployment environment: only production counts are the real ones. */
export const keyPrefix = (env = process.env.VERCEL_ENV) => (env === "production" ? "use" : `use-${env || "local"}`);

/** The UTC day, YYYY-MM-DD. */
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** The secret that keys the daily visitor tokens. */
export const tokenSecret = () => process.env.USAGE_SECRET ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

/** A visitor's token for one day: the same all day for the same IP and browser, unlinkable across days. */
export function visitorToken(secret: string, day: string, ip: string, userAgent: string): string {
  return createHmac("sha256", secret).update(`${day}\n${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

/** Crawlers, link previews, monitors and headless browsers (our own tests included) aren't people. */
const AUTOMATED = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|facebookexternalhit|playwright|puppeteer/i;
export const isAutomated = (userAgent: string | null) => !userAgent || AUTOMATED.test(userAgent);

const k = (prefix: string, day: string, part: string) => `${prefix}:${day}:${part}`;

/** Counts one use. `country` is the two-letter code Vercel gives the request (visits only). */
export async function recordUse(db: UsageDb, prefix: string, day: string, e: UsageEvent, s: string | undefined, token: string, country?: string | null): Promise<void> {
  const p = db.pipeline();
  const n = k(prefix, day, "n");
  if (e === "visit") p.pfadd(k(prefix, day, "seen"), token);
  p.pfadd(k(prefix, day, `who:${e}`), token);
  p.hincrby(n, e, 1);
  if (s) p.hincrby(n, `${e}:${s}`, 1);
  if (e === "visit" && country && /^[A-Z]{2}$/.test(country)) p.hincrby(n, `country:${country}`, 1);
  await p.exec();
}

export interface UsageDay {
  day: string;
  /** Distinct visitors that day. */
  visitors: number;
  /** Counts: "review", "review:chesscom", "country:SG", … */
  n: Record<string, number>;
}

export interface UsageReport {
  /** Oldest first. */
  days: UsageDay[];
  /** Distinct visitors over the whole range, and over the range before it (same length). */
  visitors: number;
  previousVisitors: number;
  /** Distinct visitors who did each thing, over the range. */
  people: Record<UsageEvent, number>;
  /** Counts summed over the range. */
  totals: Record<string, number>;
}

/** The last `days` UTC days up to `today`, oldest first. */
export function dayRange(today: string, days: number): string[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => utcDay(t - (days - 1 - i) * 86_400_000));
}

const num = (x: unknown) => (typeof x === "number" ? x : Number(x) || 0);

/** A hash as Redis returns it: an object, or (raw, without the client's deserializing) [field, value, …]. */
export function countsOf(raw: unknown): Record<string, number> {
  const n: Record<string, number> = {};
  if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) n[String(raw[i])] = num(raw[i + 1]);
  else if (raw && typeof raw === "object") for (const [f, v] of Object.entries(raw)) n[f] = num(v);
  return n;
}

/** Reads the counts for the last `days` days (and the visitors of the period before, for comparison). */
export async function readUsage(db: UsageDb, prefix: string, days: number, today: string): Promise<UsageReport> {
  const range = dayRange(today, days);
  const before = dayRange(range[0], days + 1).slice(0, days);
  const events = Object.keys(USAGE_EVENTS) as UsageEvent[];
  const p = db.pipeline();
  for (const d of range) p.hgetall(k(prefix, d, "n")).pfcount(k(prefix, d, "seen"));
  p.pfcount(k(prefix, range[0], "seen"), ...range.slice(1).map((d) => k(prefix, d, "seen")));
  p.pfcount(k(prefix, before[0], "seen"), ...before.slice(1).map((d) => k(prefix, d, "seen")));
  for (const e of events) p.pfcount(k(prefix, range[0], `who:${e}`), ...range.slice(1).map((d) => k(prefix, d, `who:${e}`)));
  const out = await p.exec();
  const dayStats: UsageDay[] = range.map((day, i) => ({ day, visitors: num(out[2 * i + 1]), n: countsOf(out[2 * i]) }));
  const totals: Record<string, number> = {};
  for (const d of dayStats) for (const [f, v] of Object.entries(d.n)) totals[f] = (totals[f] ?? 0) + v;
  const at = 2 * range.length;
  const people = Object.fromEntries(events.map((e, j) => [e, num(out[at + 2 + j])])) as Record<UsageEvent, number>;
  return { days: dayStats, visitors: num(out[at]), previousVisitors: num(out[at + 1]), people, totals };
}
