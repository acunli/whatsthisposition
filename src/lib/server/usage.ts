import "server-only";

/**
 * The usage counter behind /api/usage and /stats, on the project's Upstash Redis database
 * (Vercel Marketplace; KV_REST_API_URL / KV_REST_API_TOKEN). Per UTC day it keeps:
 *   {prefix}:{day}:h                  a hash of counts per UTC hour: "HH|e|review|chesscom|google|/", … (src/lib/stats/fields.ts)
 *   {prefix}:{day}:seen               a HyperLogLog of the day's people (anyone who did anything counted)
 *   {prefix}:{day}:who:{event}        a HyperLogLog of the people who did that
 *   {prefix}:{day}:{HH}:seen / :who:{event}   the same per hour (dropped after HOUR_SKETCH_DAYS)
 *   {prefix}:{day}:new                a HyperLogLog of the people first seen this month that day
 *   {prefix}:m:{YYYY-MM}:seen         a HyperLogLog of the month's people
 *   {prefix}:live:{minute}            a HyperLogLog of the people active that minute (expires after an hour)
 *   {prefix}:roll:{day}               a finished day, summed up once (JSON), so the dashboard reads it in one go
 *   {prefix}:snap:{day}               the day's outside numbers: the extension's store listing, the GitHub repository
 * (Before 2026-10-22 a day kept one hash of daily counts, {prefix}:{day}:n; it's still read.)
 *
 * A person is a monthly token, HMAC(secret, month + IP + browser), computed in memory and only
 * ever added to HyperLogLogs, which store no members: IP addresses and the tokens themselves
 * are never stored, and a token can't be linked to the next month's. (Until 2026-10-22 the
 * token changed every day.) Production writes "use:…"; preview and local runs write
 * "use-preview:…" / "use-local:…", so testing never inflates the real numbers. Without the
 * database, nothing is counted and /stats says so.
 */
import { createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";
import { USAGE_EVENT_NAMES, type Use, type UsageEvent } from "../usage";
import { DEVICE_CLASS_NAMES, REVIEW_SECONDS, VITALS, bucketOf, field, type VitalName } from "../stats/fields";
import type { Software } from "../stats/visitor";

/** The commands the counter needs, as Upstash's pipeline offers them (a fake one in tests). */
export interface UsagePipe {
  pfadd(key: string, member: string): UsagePipe;
  pfcount(key: string, ...keys: string[]): UsagePipe;
  hincrby(key: string, field: string, increment: number): UsagePipe;
  hgetall(key: string): UsagePipe;
  expire(key: string, seconds: number): UsagePipe;
  exec(): Promise<unknown[]>;
}
export interface UsageDb {
  pipeline(): UsagePipe;
  mget(...keys: string[]): Promise<unknown[]>;
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
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
/** The UTC hour, "00"–"23". */
export const utcHour = (t = Date.now()) => new Date(t).toISOString().slice(11, 13);
/** The UTC month, YYYY-MM. */
export const utcMonth = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);

/** The first day anything was counted, and the first with hourly counts and monthly tokens. */
export const COUNTING_SINCE = "2026-10-14";
export const HOURLY_SINCE = "2026-10-22";

/** The secret that keys the visitor tokens. */
export const tokenSecret = () => process.env.USAGE_SECRET ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

/** A visitor's token for one month: the same all month for the same IP and browser, unlinkable across months. */
export function visitorToken(secret: string, month: string, ip: string, userAgent: string): string {
  return createHmac("sha256", secret).update(`${month}\n${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

/** Crawlers, link previews, monitors and headless browsers (our own tests included) aren't people. */
const AUTOMATED = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|facebookexternalhit|playwright|puppeteer/i;
export const isAutomated = (userAgent: string | null) => !userAgent || AUTOMATED.test(userAgent);

/** How long the per-minute sketches live, and how many days the per-hour sketches are kept. */
const LIVE_SECONDS = 3900;
export const HOUR_SKETCH_DAYS = 35;

export const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

/** The uses that mean someone did more than open pages (for "engaged" people and the bounce rate). */
export const ENGAGED_EVENTS: UsageEvent[] = ["lookup", "review", "analysis", "photo", "side_line", "share", "get_extension", "act"];

/** Every key the counter uses. */
export function usageKeys(prefix: string) {
  return {
    hours: (day: string) => `${prefix}:${day}:h`,
    legacy: (day: string) => `${prefix}:${day}:n`,
    seen: (day: string) => `${prefix}:${day}:seen`,
    who: (day: string, e: string) => `${prefix}:${day}:who:${e}`,
    hourSeen: (day: string, hh: string) => `${prefix}:${day}:${hh}:seen`,
    hourWho: (day: string, hh: string, e: string) => `${prefix}:${day}:${hh}:who:${e}`,
    fresh: (day: string) => `${prefix}:${day}:new`,
    month: (month: string) => `${prefix}:m:${month}:seen`,
    minute: (minute: number) => `${prefix}:live:${minute}`,
    roll: (day: string) => `${prefix}:roll:${day}`,
    snap: (day: string) => `${prefix}:snap:${day}`,
    retention: (month: string) => `${prefix}:ret:${month}`,
  };
}

/** What the request says about the visitor (src/lib/stats/visitor.ts), with their monthly token. */
export interface Visitor {
  token: string;
  software: Software;
  country: string;
  region: string;
  city: string;
  lang: string;
  localHour: string;
  localDay: string;
}

const num = (x: unknown) => (typeof x === "number" ? x : Number(x) || 0);

/** Counts one use at time `t` (ms). */
export async function recordUse(db: UsageDb, prefix: string, t: number, use: Use, v: Visitor): Promise<void> {
  const K = usageKeys(prefix);
  const day = utcDay(t);
  const hh = utcHour(t);
  const h = K.hours(day);
  const at = (...parts: (string | number | undefined)[]) => `${hh}|${field(...parts)}`;
  const p = db.pipeline();
  let commands = 0;
  const add = (f: string, by = 1) => (p.hincrby(h, f, by), commands++);
  if (use.e === "leave") {
    for (const [page, secs] of Object.entries(use.t ?? {})) if (secs > 0) add(at("s", page), secs);
    for (const [name, value] of Object.entries(use.v ?? {})) add(at("w", name, v.software.device, bucketOf(VITALS[name as VitalName].bounds, value)));
    if (commands) await p.exec();
    return;
  }
  add(at("e", use.e, use.s, use.c, use.p));
  if (use.e === "visit") {
    add(at("g", v.country, v.region, v.city, v.lang, v.localHour, v.localDay));
    add(at("t", v.software.device, v.software.os, v.software.browser, ...DEVICE_CLASS_NAMES.map((k) => use.d?.[k])));
  }
  if (use.e === "review_done" && use.n !== undefined) {
    add(at("d", use.s, bucketOf(REVIEW_SECONDS, use.n)));
    add(at("ds", use.s), use.n);
  }
  if (use.e === "error" && use.x) add(at("x", use.s, use.x));
  const first = commands;
  const minute = Math.floor(t / 60_000);
  p.pfadd(K.seen(day), v.token)
    .pfadd(K.month(utcMonth(t)), v.token)
    .pfadd(K.who(day, use.e), v.token)
    .pfadd(K.hourSeen(day, hh), v.token)
    .pfadd(K.hourWho(day, hh, use.e), v.token)
    .pfadd(K.minute(minute), v.token)
    .expire(K.minute(minute), LIVE_SECONDS);
  const out = await p.exec();
  // The person's first use today: new this month, or back from an earlier day of it.
  if (num(out[first]) === 1) {
    const isNew = num(out[first + 1]) === 1;
    const q = db.pipeline().hincrby(h, at("r", isNew ? "new" : "back"), 1);
    if (isNew) q.pfadd(K.fresh(day), v.token);
    await q.exec();
  }
}

/** A hash as Redis returns it: an object, or (raw, without the client's deserializing) [field, value, …]. */
export function countsOf(raw: unknown): Record<string, number> {
  const n: Record<string, number> = {};
  if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) n[String(raw[i])] = num(raw[i + 1]);
  else if (raw && typeof raw === "object") for (const [f, v] of Object.entries(raw)) n[f] = num(v);
  return n;
}

/**
 * A day's counts from before 2026-10-22 ("visit", "visit:direct", "arrive:google", "country:SG")
 * in today's field format, without an hour: per source where one was given, the rest without.
 */
export function legacyFields(n: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (f: string, by: number) => by > 0 && (out[f] = (out[f] ?? 0) + by);
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith("country:")) put(field("g", k.slice(8), "", "", "", "", ""), v);
    else if (!k.includes(":")) {
      const sourced = Object.entries(n).filter(([s]) => s.startsWith(`${k}:`));
      for (const [s, c] of sourced) put(field("e", k, s.slice(k.length + 1), "", ""), c);
      put(field("e", k, "", "", ""), v - sourced.reduce((a, [, c]) => a + c, 0));
    }
  }
  return out;
}

/** Metrics per hour: uses of each kind, seconds visible ("time"), people new or back. */
export type HourMetrics = Record<string, number>;

/** One UTC day, summed up. */
export interface DayData {
  day: string;
  /** People active that day, and those first seen this month that day. */
  people: number;
  newPeople: number;
  /** People active per UTC hour (zeros before hourly counting). */
  hourPeople: number[];
  /** Whether the day has hourly counts (from 2026-10-22). */
  hourly: boolean;
  /** People who did each thing. */
  who: Partial<Record<UsageEvent, number>>;
  /** Every count of the day, without its hour (src/lib/stats/fields.ts). */
  fields: Record<string, number>;
  /** Metrics per hour, "00"–"23". */
  hours: HourMetrics[];
  /** The hourly hash itself ("HH|…"), when the day was read rather than taken from its roll-up. */
  raw?: Record<string, number>;
}

const ROLL_VERSION = 1;

/** The metrics an hourly field adds to its hour. */
export function addMetrics(m: HourMetrics, f: string, n: number) {
  const [kind, a] = f.split("|", 2);
  if (kind === "e") m[a] = (m[a] ?? 0) + n;
  else if (kind === "s") m.time = (m.time ?? 0) + n;
  else if (kind === "r") m[a] = (m[a] ?? 0) + n;
}

/** A day from its hourly hash, its old daily hash, and its sketches' counts. */
export function dayFromRaw(day: string, raw: Record<string, number>, legacy: Record<string, number>, people: number, newPeople: number, hourPeople: number[], who: Partial<Record<UsageEvent, number>>): DayData {
  const fields = legacyFields(legacy);
  const hours: HourMetrics[] = HOURS.map(() => ({}));
  for (const [f, n] of Object.entries(raw)) {
    const hh = Number(f.slice(0, 2));
    const rest = f.slice(3);
    if (!(hh >= 0 && hh < 24) || f[2] !== "|") continue;
    fields[rest] = (fields[rest] ?? 0) + n;
    addMetrics(hours[hh], rest, n);
  }
  return { day, people, newPeople, hourPeople, hourly: Object.keys(raw).length > 0, who, fields, hours, raw };
}

/**
 * Reads days: finished ones from their roll-ups (one command for all of them), the rest from
 * the counts themselves, rolling up any finished day that had none. `raw` forces a fresh read
 * that keeps the hourly hash (for windows that start mid-day).
 */
export async function readDays(db: UsageDb, prefix: string, days: string[], today: string, raw = false): Promise<DayData[]> {
  const K = usageKeys(prefix);
  const byDay = new Map<string, DayData>();
  const past = raw ? [] : days.filter((d) => d < today);
  if (past.length) {
    const rolls = await db.mget(...past.map(K.roll));
    past.forEach((d, i) => {
      const r = rolls[i];
      if (typeof r !== "string") return;
      try {
        const data = JSON.parse(r) as DayData & { v?: number };
        if (data.v === ROLL_VERSION) byDay.set(d, { ...data, day: d });
      } catch {
        // read it again below
      }
    });
  }
  const missing = days.filter((d) => !byDay.has(d));
  if (missing.length) {
    const p = db.pipeline();
    for (const d of missing) {
      p.hgetall(K.hours(d)).hgetall(K.legacy(d)).pfcount(K.seen(d)).pfcount(K.fresh(d));
      for (const hh of HOURS) p.pfcount(K.hourSeen(d, hh));
      for (const e of USAGE_EVENT_NAMES) p.pfcount(K.who(d, e));
    }
    const out = await p.exec();
    const per = 4 + HOURS.length + USAGE_EVENT_NAMES.length;
    const rolled: [string, string][] = [];
    missing.forEach((d, i) => {
      const o = out.slice(i * per, (i + 1) * per);
      const who = Object.fromEntries(USAGE_EVENT_NAMES.map((e, j) => [e, num(o[4 + HOURS.length + j])]).filter(([, n]) => n)) as DayData["who"];
      const data = dayFromRaw(d, countsOf(o[0]), countsOf(o[1]), num(o[2]), num(o[3]), o.slice(4, 4 + HOURS.length).map(num), who);
      byDay.set(d, data);
      if (d < today) {
        const { raw: _raw, ...kept } = data;
        void _raw;
        rolled.push([K.roll(d), JSON.stringify({ v: ROLL_VERSION, ...kept })]);
      }
    });
    await Promise.all(rolled.map(([k, v]) => db.set(k, v)));
  }
  return days.map((d) => byDay.get(d)!);
}

/** How many distinct people are in each group of sketches (one command per group). */
export async function countPeople(db: UsageDb, groups: string[][]): Promise<number[]> {
  const live = groups.map((g, i) => [g, i] as const).filter(([g]) => g.length);
  if (!live.length) return groups.map(() => 0);
  const p = db.pipeline();
  for (const [g] of live) p.pfcount(g[0], ...g.slice(1));
  const out = await p.exec();
  const res = groups.map(() => 0);
  live.forEach(([, i], j) => (res[i] = num(out[j])));
  return res;
}

/** An hour of a rolling window: its start (ms), its people, and its counts (without the hour). */
export interface HourData {
  t: number;
  people: number;
  fields: Record<string, number>;
  metrics: HourMetrics;
}

export interface HourWindow {
  hours: HourData[];
  /** Distinct people over the window, per use, and who did more than open pages (ENGAGED_EVENTS). */
  people: number;
  who: Partial<Record<UsageEvent, number>>;
  engaged: number;
}

/** The `count` hours ending before `end` (ms, an hour boundary), each with its own counts. */
export async function readHours(db: UsageDb, prefix: string, end: number, count: number, withWho = true): Promise<HourWindow> {
  const K = usageKeys(prefix);
  const starts = Array.from({ length: count }, (_, i) => end - (count - i) * 3_600_000);
  const days = [...new Set(starts.map((t) => utcDay(t)))];
  const p = db.pipeline();
  for (const d of days) p.hgetall(K.hours(d));
  for (const t of starts) p.pfcount(K.hourSeen(utcDay(t), utcHour(t)));
  const all = starts.map((t) => K.hourSeen(utcDay(t), utcHour(t)));
  p.pfcount(all[0], ...all.slice(1));
  if (withWho) {
    for (const e of USAGE_EVENT_NAMES) {
      const ks = starts.map((t) => K.hourWho(utcDay(t), utcHour(t), e));
      p.pfcount(ks[0], ...ks.slice(1));
    }
    const ks = starts.flatMap((t) => ENGAGED_EVENTS.map((e) => K.hourWho(utcDay(t), utcHour(t), e)));
    p.pfcount(ks[0], ...ks.slice(1));
  }
  const out = await p.exec();
  const hashes = new Map(days.map((d, i) => [d, countsOf(out[i])]));
  const hours = starts.map((t, i): HourData => {
    const hh = utcHour(t);
    const fields: Record<string, number> = {};
    const metrics: HourMetrics = {};
    for (const [f, n] of Object.entries(hashes.get(utcDay(t))!)) {
      if (!f.startsWith(`${hh}|`)) continue;
      fields[f.slice(3)] = n;
      addMetrics(metrics, f.slice(3), n);
    }
    return { t, people: num(out[days.length + i]), fields, metrics };
  });
  const at = days.length + count;
  const who = withWho ? (Object.fromEntries(USAGE_EVENT_NAMES.map((e, j) => [e, num(out[at + 1 + j])]).filter(([, n]) => n)) as HourWindow["who"]) : {};
  return { hours, people: num(out[at]), who, engaged: withWho ? num(out[at + 1 + USAGE_EVENT_NAMES.length]) : 0 };
}

/** Days `from` to `to` (YYYY-MM-DD), inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000) out.push(utcDay(t));
  return out;
}

/** The last `days` UTC days up to `today`, oldest first. */
export function dayRange(today: string, days: number): string[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => utcDay(t - (days - 1 - i) * 86_400_000));
}

/** Returning visitors within a month: of the people first seen each day, how many came back later. */
export interface Retention {
  month: string;
  /** The month's people (distinct), and per day. */
  people: number;
  daily: { day: string; people: number }[];
  /** Per day: people first seen that month that day, how many were back 1–7 days later, and on any later day. */
  cohorts: { day: string; size: number; back: (number | null)[]; later: number | null }[];
}

/** Of a and b, how many are in both: |a| + |b| − |a ∪ b|, kept within what's possible (the sketches are estimates). */
const both = (a: number, b: number, union: number) => Math.max(0, Math.min(a, b, a + b - union));

/** Retention for one month (only days from HOURLY_SINCE, when tokens became monthly). Finished months are kept. */
export async function readRetention(db: UsageDb, prefix: string, month: string, today: string): Promise<Retention> {
  const K = usageKeys(prefix);
  const done = month < today.slice(0, 7);
  if (done) {
    const kept = await db.get(K.retention(month));
    if (typeof kept === "string") {
      try {
        return JSON.parse(kept) as Retention;
      } catch {
        // computed again below
      }
    }
  }
  const [y, mo] = month.split("-").map(Number);
  const endDay = done ? utcDay(Date.UTC(y, mo, 0)) : today;
  const start = `${month}-01` < HOURLY_SINCE ? HOURLY_SINCE : `${month}-01`;
  const days = start <= endDay ? daysBetween(start, endDay) : [];
  const groups: string[][] = [];
  for (const d of days) groups.push([K.fresh(d)], [K.seen(d)]);
  groups.push(days.map(K.seen));
  days.forEach((d, i) => {
    for (let k = 1; k <= 7; k++) if (days[i + k]) groups.push([K.fresh(d), K.seen(days[i + k])]);
    const later = days.slice(i + 1).map(K.seen);
    if (later.length) groups.push(later, [K.fresh(d), ...later]);
  });
  const counts = await countPeople(db, groups);
  let j = 0;
  const fresh: number[] = [];
  const seen: number[] = [];
  for (let i = 0; i < days.length; i++) {
    fresh.push(counts[j++]);
    seen.push(counts[j++]);
  }
  const people = days.length ? counts[j++] : 0;
  const cohorts = days.map((d, i) => {
    const back: (number | null)[] = [];
    for (let k = 1; k <= 7; k++) back.push(days[i + k] ? both(fresh[i], seen[i + k], counts[j++]) : null);
    let later: number | null = null;
    if (i + 1 < days.length) {
      const laterPeople = counts[j++];
      later = both(fresh[i], laterPeople, counts[j++]);
    }
    return { day: d, size: fresh[i], back, later };
  });
  const r: Retention = { month, people, daily: days.map((day, i) => ({ day, people: seen[i] })), cohorts };
  if (done) await db.set(K.retention(month), JSON.stringify(r));
  return r;
}

/** Right now: people active per minute over the last half hour, and in the last 5, 30 and 60 minutes. */
export interface Live {
  at: number;
  minutes: { t: number; people: number }[];
  last5: number;
  last30: number;
  last60: number;
  /** This hour's and the last hour's counts (UTC), without the hour. */
  fields: Record<string, number>;
}

export async function readLive(db: UsageDb, prefix: string, now = Date.now()): Promise<Live> {
  const K = usageKeys(prefix);
  const m = Math.floor(now / 60_000);
  const mins = (n: number) => Array.from({ length: n }, (_, i) => K.minute(m - i));
  const p = db.pipeline();
  for (let i = 29; i >= 0; i--) p.pfcount(K.minute(m - i));
  const [a, b, c] = [mins(5), mins(30), mins(60)];
  p.pfcount(a[0], ...a.slice(1)).pfcount(b[0], ...b.slice(1)).pfcount(c[0], ...c.slice(1));
  const prev = now - 3_600_000;
  const days = [...new Set([utcDay(now), utcDay(prev)])];
  for (const d of days) p.hgetall(K.hours(d));
  const out = await p.exec();
  const fields: Record<string, number> = {};
  const wanted = new Set([`${utcDay(now)}|${utcHour(now)}`, `${utcDay(prev)}|${utcHour(prev)}`]);
  days.forEach((d, i) => {
    for (const [f, n] of Object.entries(countsOf(out[33 + i]))) {
      if (!wanted.has(`${d}|${f.slice(0, 2)}`)) continue;
      fields[f.slice(3)] = (fields[f.slice(3)] ?? 0) + n;
    }
  });
  return {
    at: now,
    minutes: Array.from({ length: 30 }, (_, i) => ({ t: (m - 29 + i) * 60_000, people: num(out[i]) })),
    last5: num(out[30]),
    last30: num(out[31]),
    last60: num(out[32]),
    fields,
  };
}

/** The day's outside numbers: the extension's store listing, the code's GitHub repository, the site's own content. */
export interface Snapshot {
  day: string;
  store?: { users: number; rating: number | null; ratings: number | null };
  github?: { stars: number; forks: number; watchers: number; issues: number };
  games?: number;
}

export async function saveSnapshot(db: UsageDb, prefix: string, snap: Snapshot): Promise<void> {
  await db.set(usageKeys(prefix).snap(snap.day), JSON.stringify(snap));
}

export async function readSnapshots(db: UsageDb, prefix: string, days: string[]): Promise<Snapshot[]> {
  if (!days.length) return [];
  const out = await db.mget(...days.map(usageKeys(prefix).snap));
  return out.flatMap((r) => {
    if (typeof r !== "string") return [];
    try {
      return [JSON.parse(r) as Snapshot];
    } catch {
      return [];
    }
  });
}

/** Drops a day's per-hour sketches (the roll-up keeps their counts): one command. */
export async function forgetHours(db: UsageDb, prefix: string, day: string): Promise<void> {
  const K = usageKeys(prefix);
  await db.del(...HOURS.flatMap((hh) => [K.hourSeen(day, hh), ...USAGE_EVENT_NAMES.map((e) => K.hourWho(day, hh, e))]));
}
