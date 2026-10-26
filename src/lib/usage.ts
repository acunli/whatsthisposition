/**
 * Anonymous usage counting: which uses of the site are counted, and the call that counts one.
 * The browser keeps no cookie or identifier, and nothing about the game, position or photo is
 * sent: only the kind of use and where it started (e.g. "review", "chesscom"), the page it
 * happened on, the channel the visit came from, and for each page load a few coarse classes of
 * the device (window width, touch or mouse, theme, processor threads…), how long pages were
 * visible and how fast they loaded, and when something breaks, the kind of error and the line of
 * the site's own scripts it happened on (src/lib/stats/fields.ts). The server (src/lib/server/usage.ts)
 * counts it per UTC hour; the owner reads the totals at /stats.
 */

import { CHANNELS, type Channel } from "./channel";
import { REVIEW_DEPTHS } from "./review/depths";
import { DEVICE_CLASSES, ERROR_WHERE, MAX_SECONDS, VITALS, pagePath, type DeviceClass, type DeviceClasses, type VitalName } from "./stats/fields";

/** Where a game import can go wrong, and how. */
export const IMPORT_SITES = ["chesscom", "lichess", "link", "pgn", "file"] as const;
export const IMPORT_ERRORS = ["notfound", "empty", "limited", "failed", "offline", "unreadable"] as const;

/** Every use that is counted, with the sources it may come from. Anything else is refused. */
export const USAGE_EVENTS = {
  /** A page of the site loaded: directly, from the extension's link, or from a shared #review link. */
  visit: ["direct", "extension", "link"],
  /** Another page opened within the site, without a new page load. */
  page: [],
  /** The page was hidden or closed: how long its pages were visible, and how fast it loaded. */
  leave: [],
  /** Before 2026-10-22 the channel a visitor came from was its own use; it now rides on the visit. */
  arrive: CHANNELS,
  /** A player's recent games listed, by site (or a game link opened). */
  lookup: ["chesscom", "lichess", "link"],
  /** A game that couldn't be brought in, by where and why ("chesscom.notfound"). */
  import_error: IMPORT_SITES.flatMap((s) => IMPORT_ERRORS.map((k) => `${s}.${k}`)),
  /** A game review started, by where the game came from. */
  review: ["chesscom", "lichess", "pgn", "file", "extension", "link"],
  /** A review the engine finished here (not one handed over already done), by its depth. */
  review_done: REVIEW_DEPTHS.map((d) => d.label.toLowerCase()),
  /** A position analysis, by how it started. */
  analysis: ["fen", "sample", "setup", "photo", "review", "link"],
  /** A screenshot or photo read into a position, on the device or by the cloud reader. */
  photo: ["device", "cloud"],
  /** The first side line played in a review. */
  side_line: [],
  /** A review shared as a public link (/r/…). */
  share: [],
  /** A click on "Add to Chrome" (the extension's store page), by where on the site. */
  get_extension: ["header", "hero", "section", "closing", "footer"],
  /** A setting changed: the review's depth, the theme. */
  act: ["depth", "theme"],
  /** Something broke: a page's error screen, an uncaught script error, the engine failing. */
  error: ["page", "script", "engine"],
} as const satisfies Record<string, readonly string[]>;

export type UsageEvent = keyof typeof USAGE_EVENTS;
export type UsageSource<E extends UsageEvent> = (typeof USAGE_EVENTS)[E][number];
export const USAGE_EVENT_NAMES = Object.keys(USAGE_EVENTS) as UsageEvent[];

/** One counted use, as the server accepts it. */
export interface Use {
  e: UsageEvent;
  s?: string;
  /** The page it happened on (pagePath). */
  p?: string;
  /** The channel the visit came from (src/lib/channel.ts). */
  c?: Channel;
  /** Seconds a finished review took (review_done). */
  n?: number;
  /** The device's classes (visit). */
  d?: DeviceClasses;
  /** Seconds each page was visible since the last report (leave). */
  t?: Record<string, number>;
  /** Page-speed measurements (leave). */
  v?: Partial<Record<VitalName, number>>;
  /** Where an error happened in the site's scripts (error; ERROR_WHERE). */
  x?: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const wholeSeconds = (x: unknown, max: number) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max;

/** A counted use, checked against the lists (unknown events, sources or classes are refused). */
export function parseUse(body: unknown): Use | null {
  if (!isObject(body)) return null;
  const { e, s, p, c, n, d, t, v, x } = body;
  if (typeof e !== "string" || !Object.hasOwn(USAGE_EVENTS, e)) return null;
  const use: Use = { e: e as UsageEvent };
  const allowed = USAGE_EVENTS[use.e] as readonly string[];
  if (s !== undefined && s !== null) {
    if (typeof s !== "string" || !allowed.includes(s)) return null;
    use.s = s;
  }
  if (p !== undefined) {
    if (typeof p !== "string" || p.length > 200) return null;
    use.p = pagePath(p);
  }
  if (c !== undefined) {
    if (typeof c !== "string" || !(CHANNELS as readonly string[]).includes(c)) return null;
    use.c = c as Channel;
  }
  if (n !== undefined) {
    if (use.e !== "review_done" || !wholeSeconds(n, 86_400)) return null;
    use.n = n as number;
  }
  if (d !== undefined) {
    if (use.e !== "visit" || !isObject(d)) return null;
    use.d = {};
    for (const [k, x] of Object.entries(d)) {
      if (!Object.hasOwn(DEVICE_CLASSES, k) || typeof x !== "string" || !(DEVICE_CLASSES[k as DeviceClass] as readonly string[]).includes(x)) return null;
      use.d[k as DeviceClass] = x;
    }
  }
  if (t !== undefined) {
    if (use.e !== "leave" || !isObject(t) || Object.keys(t).length > 12) return null;
    use.t = {};
    for (const [page, secs] of Object.entries(t)) {
      if (!wholeSeconds(secs, MAX_SECONDS) || page.length > 200) return null;
      const key = pagePath(page);
      use.t[key] = (use.t[key] ?? 0) + (secs as number);
    }
  }
  if (v !== undefined) {
    if (use.e !== "leave" || !isObject(v)) return null;
    use.v = {};
    for (const [k, x] of Object.entries(v)) {
      if (!Object.hasOwn(VITALS, k) || typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 600_000) return null;
      use.v[k as VitalName] = x;
    }
  }
  if (x !== undefined) {
    if (use.e !== "error" || typeof x !== "string" || !ERROR_WHERE.test(x)) return null;
    use.x = x;
  }
  return use;
}

/** The channel this page load came from, sent along with what the visitor does next (kept in memory only). */
let visitChannel: Channel | undefined;
export function rememberChannel(c: Channel | null) {
  visitChannel = c ?? undefined;
}

/** Counting is off when the browser asks not to be tracked (Global Privacy Control or Do Not Track). */
export function countingAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !(nav.globalPrivacyControl || nav.doNotTrack === "1");
}

/** Sends one use, fire-and-forget: it never delays or breaks what the visitor is doing. */
export function sendUse(use: Use): void {
  if (!countingAllowed()) return;
  const body = JSON.stringify(use);
  try {
    if (navigator.sendBeacon?.("/api/usage", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall back to fetch
  }
  void fetch("/api/usage", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
}

/**
 * Counts one use, with the page it happened on and the channel the visit came from. Skipped
 * when the browser asks not to be tracked.
 */
export function countUse<E extends UsageEvent>(e: E, s?: UsageSource<E>, extra?: Omit<Use, "e" | "s">): void {
  if (typeof window === "undefined") return;
  sendUse({ e, ...(s ? { s } : {}), p: pagePath(window.location.pathname), ...(visitChannel ? { c: visitChannel } : {}), ...extra });
}

/** The device's coarse classes for a visit (DEVICE_CLASSES); what a browser doesn't say is left out. */
export function deviceClasses(): DeviceClasses {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
  const w = window.innerWidth;
  const out: DeviceClasses = {
    vw: w < 480 ? "xs" : w < 768 ? "sm" : w < 1024 ? "md" : w < 1440 ? "lg" : "xl",
    input: window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
    app: window.matchMedia("(display-mode: standalone)").matches ? "app" : "browser",
  };
  const set = document.documentElement.getAttribute("data-theme");
  const theme = set === "light" || set === "dark" ? set : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  out.theme = set === theme ? `${theme}-picked` : theme;
  const c = nav.hardwareConcurrency;
  if (c) out.cores = c <= 2 ? "1-2" : c <= 4 ? "3-4" : c <= 8 ? "5-8" : c <= 16 ? "9-16" : "17+";
  const m = nav.deviceMemory;
  if (m) out.mem = m <= 1 ? "1" : m <= 2 ? "2" : m <= 4 ? "4" : "8";
  const net = nav.connection;
  if (net?.saveData) out.net = "save";
  else if (net?.effectiveType && (DEVICE_CLASSES.net as readonly string[]).includes(net.effectiveType)) out.net = net.effectiveType;
  const r = window.devicePixelRatio;
  if (r) out.dpr = r < 1.25 ? "1" : r < 1.75 ? "1.5" : r < 2.5 ? "2" : "3";
  return out;
}
