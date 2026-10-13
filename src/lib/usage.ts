/**
 * Anonymous usage counting: which uses of the site are counted, and the call that counts one.
 * The browser keeps no cookie or identifier, and nothing about the game, position or photo is
 * sent: only the kind of use and where it started (e.g. "review", "chesscom"). The server
 * (src/lib/server/usage.ts) counts it per UTC day; the owner reads the totals at /stats.
 */

/** Every use that is counted, with the sources it may come from. Anything else is refused. */
export const USAGE_EVENTS = {
  /** The app opened: directly, from the extension's link, or from a shared #review link. */
  visit: ["direct", "extension", "link"],
  /** A game review started, by where the game came from. */
  review: ["chesscom", "lichess", "pgn", "file", "extension", "link"],
  /** A review the engine finished here (not one handed over already done). */
  review_done: [],
  /** A position analysis, by how it started. */
  analysis: ["fen", "sample", "setup", "photo", "review", "link"],
  /** A screenshot or photo read into a position, on the device or by the cloud reader. */
  photo: ["device", "cloud"],
  /** The first side line played in a review. */
  side_line: [],
} as const satisfies Record<string, readonly string[]>;

export type UsageEvent = keyof typeof USAGE_EVENTS;
export type UsageSource<E extends UsageEvent> = (typeof USAGE_EVENTS)[E][number];

/** A counted use, checked against the list (unknown events or sources are refused). */
export function parseUse(body: unknown): { e: UsageEvent; s?: string } | null {
  if (!body || typeof body !== "object") return null;
  const { e, s } = body as { e?: unknown; s?: unknown };
  if (typeof e !== "string" || !Object.hasOwn(USAGE_EVENTS, e)) return null;
  const allowed = USAGE_EVENTS[e as UsageEvent] as readonly string[];
  if (s === undefined || s === null) return { e: e as UsageEvent };
  if (typeof s !== "string" || !allowed.includes(s)) return null;
  return { e: e as UsageEvent, s };
}

/**
 * Counts one use, fire-and-forget: it never delays or breaks what the visitor is doing. Skipped
 * when the browser asks not to be tracked (Global Privacy Control or Do Not Track).
 */
export function countUse<E extends UsageEvent>(e: E, s?: UsageSource<E>): void {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl || nav.doNotTrack === "1") return;
  const body = JSON.stringify(s ? { e, s } : { e });
  try {
    if (nav.sendBeacon?.("/api/usage", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall back to fetch
  }
  void fetch("/api/usage", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
}
