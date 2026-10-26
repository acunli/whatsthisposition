/**
 * The vocabulary of the usage counter: which page a use happened on, the coarse device and
 * speed classes a page load reports, and how one counted use is written as fields of a day's
 * hourly hash. Shared by the browser (which sends only these classes), the server (which checks
 * them again and refuses anything else) and the dashboard (which reads the fields back).
 */

/** Pages counted by their own address. Shared reviews and reviewed games are grouped below. */
export const SITE_PAGES = [
  "/",
  "/review",
  "/games",
  "/credits",
  "/chess-com-game-review",
  "/lichess-game-review",
  "/pgn-analyzer",
  "/chess-position-analyzer",
  "/chess-com-extension",
  "/chess-move-classifications",
] as const;

/** Every shared review (/r/<id>) counts as one page: the ids aren't kept. */
export const SHARED_REVIEW_PAGE = "/r/*";

/**
 * The page a use happened on, as the counter keeps it: a page of the site, "/r/*" for any shared
 * review, a reviewed game's article or review page, or "other" (an address that isn't a page).
 * Applying it twice gives the same answer, so the server can check what the browser sent.
 */
export function pagePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if ((SITE_PAGES as readonly string[]).includes(p)) return p;
  if (/^\/r\/[^/]+$/.test(p)) return SHARED_REVIEW_PAGE;
  if (/^\/games\/[a-z0-9-]{1,100}(\/review)?$/.test(p)) return p;
  return "other";
}

/** The classes a page load reports about the device (src/lib/usage.ts, `deviceClasses`); "" is unknown. */
export const DEVICE_CLASSES = {
  /** Window width: under 480, 480–767, 768–1023, 1024–1439, 1440 and wider (CSS pixels). */
  vw: ["xs", "sm", "md", "lg", "xl"],
  /** A coarse pointer (a finger) or a fine one (mouse, trackpad, pen). */
  input: ["touch", "mouse"],
  /** The theme in use, and whether the visitor picked it with the toggle. */
  theme: ["dark", "light", "dark-picked", "light-picked"],
  /** Processor threads (the engine runs one search per thread, up to 7). */
  cores: ["1-2", "3-4", "5-8", "9-16", "17+"],
  /** Memory in GB as the browser rounds it (Chromium only). */
  mem: ["1", "2", "4", "8"],
  /** The connection the browser estimates (Chromium only); "save" is Data Saver. */
  net: ["4g", "3g", "2g", "slow-2g", "save"],
  /** Opened as an installed app, or in a browser tab. */
  app: ["app", "browser"],
  /** Screen pixels per CSS pixel. */
  dpr: ["1", "1.5", "2", "3"],
} as const satisfies Record<string, readonly string[]>;

export type DeviceClass = keyof typeof DEVICE_CLASSES;
export type DeviceClasses = Partial<Record<DeviceClass, string>>;
export const DEVICE_CLASS_NAMES = Object.keys(DEVICE_CLASSES) as DeviceClass[];

/**
 * Web Vitals (the page-speed measurements browsers report), kept as counts per range of values.
 * The ranges include Google's "good" and "poor" limits, so the share of good, needs-improvement
 * and poor loads is exact; the 75th percentile is estimated within its range.
 */
export const VITALS = {
  /** Largest Contentful Paint: when the main content showed (ms). */
  LCP: { bounds: [500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000], good: 2500, poor: 4000 },
  /** First Contentful Paint: when anything showed (ms). */
  FCP: { bounds: [300, 600, 1000, 1400, 1800, 2400, 3000, 4000, 6000], good: 1800, poor: 3000 },
  /** Interaction to Next Paint: how fast the page answers clicks and taps (ms). */
  INP: { bounds: [50, 100, 150, 200, 300, 500, 800, 1500], good: 200, poor: 500 },
  /** Cumulative Layout Shift: how much the page jumped around (unitless). */
  CLS: { bounds: [0.01, 0.05, 0.1, 0.15, 0.25, 0.4, 1], good: 0.1, poor: 0.25 },
  /** Time to First Byte: how fast the server answered (ms). */
  TTFB: { bounds: [100, 200, 400, 600, 800, 1200, 1800, 3000], good: 800, poor: 1800 },
} as const satisfies Record<string, { bounds: readonly number[]; good: number; poor: number }>;

export type VitalName = keyof typeof VITALS;
export const VITAL_NAMES = Object.keys(VITALS) as VitalName[];

/** The range a value falls in: 0 for up to the first bound, …, bounds.length for above the last. */
export function bucketOf(bounds: readonly number[], value: number): number {
  const i = bounds.findIndex((b) => value <= b);
  return i < 0 ? bounds.length : i;
}

/** How long a finished review took, in seconds. */
export const REVIEW_SECONDS = [10, 20, 30, 45, 60, 90, 120, 180, 300, 600] as const;

/** The longest stretch of visible time one page load reports at once (an hour). */
export const MAX_SECONDS = 3600;

/** A field segment: the separator can't appear inside one. */
const seg = (x: string | number | null | undefined) => String(x ?? "").replace(/\|/g, "");

/** Joins field segments ("e", "review", "chesscom", …) into one hash field. */
export const field = (...parts: (string | number | null | undefined)[]) => parts.map(seg).join("|");

/**
 * Whether a count (a field without its hour) is games reviewed, for the home page's total: every
 * review started on the site, but not a shared review or a published one (/games/…) being opened,
 * which was reviewed before.
 */
export function isGameReview(f: string): boolean {
  const [kind, event, , , page = ""] = f.split("|");
  return kind === "e" && event === "review" && page !== SHARED_REVIEW_PAGE && !page.startsWith("/games/");
}

/**
 * The fields one use writes, each counted once (or by `by`). Kinds, after the UTC hour "HH|":
 *   e|event|source|channel|page          every use but `leave`
 *   g|country|region|city|lang|hour|day  a visit's place and the visitor's local time
 *   t|device|os|browser|vw|input|theme|cores|mem|net|app|dpr   a visit's device
 *   s|page                               seconds the page was visible (`leave`)
 *   w|vital|device|range                 one page-speed measurement (`leave`)
 *   d|depth|range, ds|depth              a finished review's time: its range, and the seconds
 *   r|new, r|back                        a person's first use of the day: new this month or back
 *   x|source|where                       an error's kind and place in the site's own scripts (ERROR_WHERE)
 */
export type FieldKind = "e" | "g" | "t" | "s" | "w" | "d" | "ds" | "r" | "x";

/**
 * Where an error happened: its kind, and the file, line and column in the site's own (minified)
 * scripts, e.g. "TypeError@0gij9ks01ahg.js:342:24176". Never the message, which can hold a move or a name.
 */
export const ERROR_WHERE = /^(TypeError|RangeError|ReferenceError|SyntaxError|Error|other)(@[A-Za-z0-9_-]{1,40}\.js:\d{1,7}:\d{1,7})?$/;

/** An error's kind and place (ERROR_WHERE), read from its stack's first frame in one of the site's scripts. */
export function errorWhere(error: unknown, origin: string): string {
  const name = error instanceof Error && /^(TypeError|RangeError|ReferenceError|SyntaxError|Error)$/.test(error.name) ? error.name : "other";
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  for (const m of stack.matchAll(/(https?:\/\/[^\s()]+?)\/_next\/static\/chunks\/(?:[^\s()/]+\/)*([A-Za-z0-9_-]{1,40}\.js):(\d{1,7}):(\d{1,7})/g))
    if (m[1] === origin) return `${name}@${m[2]}:${m[3]}:${m[4]}`;
  return name;
}
