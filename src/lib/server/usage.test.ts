import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUse, type Use } from "../usage";
import { isGameReview } from "../stats/fields";

vi.mock("server-only", () => ({}));
const U = await import("./usage");
const { countsOf, dayFromRaw, forgetHours, isAutomated, keyPrefix, legacyFields, readDays, readHours, readLive, readRetention, recordUse, visitorToken, countPeople, usageKeys } = U;
const { statsAllowed } = await import("./statsAuth");
const { readDashboard } = await import("./dashboard");
const { readStorePage } = await import("./snapshot");
const { periodOf } = await import("../stats/period");
type Db = import("./usage").UsageDb;
type Pipe = import("./usage").UsagePipe;
type Visitor = import("./usage").Visitor;

/** An in-memory stand-in for the Redis commands the counter uses (HyperLogLogs as exact sets). */
function fakeDb() {
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, number>>();
  const strings = new Map<string, string>();
  const expiring = new Set<string>();
  const calls = { pipelines: 0, hgetall: 0, mget: 0 };
  const db: Db & { sets: typeof sets; hashes: typeof hashes; strings: typeof strings; expiring: typeof expiring; calls: typeof calls } = {
    sets,
    hashes,
    strings,
    expiring,
    calls,
    pipeline() {
      calls.pipelines++;
      const ops: (() => unknown)[] = [];
      const p: Pipe = {
        pfadd: (key, member) =>
          (ops.push(() => {
            const s = sets.get(key) ?? sets.set(key, new Set()).get(key)!;
            const had = s.has(member);
            s.add(member);
            return had ? 0 : 1;
          }),
          p),
        pfcount: (...keys) => (ops.push(() => new Set(keys.flatMap((k) => [...(sets.get(k) ?? [])])).size), p),
        hincrby: (key, field, by) =>
          (ops.push(() => {
            const h = hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
            h.set(field, (h.get(field) ?? 0) + by);
            return h.get(field);
          }),
          p),
        hgetall: (key) => (ops.push(() => (calls.hgetall++, hashes.has(key) ? Object.fromEntries(hashes.get(key)!) : null)), p),
        incr: (key) => (ops.push(() => (strings.set(key, String(Number(strings.get(key) ?? 0) + 1)), Number(strings.get(key)))), p),
        expire: (key) => (ops.push(() => (expiring.add(key), 1)), p),
        exec: async () => ops.map((f) => f()),
      };
      return p;
    },
    mget: async (...keys) => (calls.mget++, keys.map((k) => strings.get(k) ?? null)),
    get: async (key) => strings.get(key) ?? null,
    set: async (key, value, opts) => (opts?.nx && strings.has(key) ? null : (strings.set(key, value), "OK")),
    del: async (...keys) => keys.reduce((n, k) => n + (sets.delete(k) || hashes.delete(k) || strings.delete(k) ? 1 : 0), 0),
  };
  return db;
}

const at = (iso: string) => Date.parse(iso);
const person = (token: string, over: Partial<Visitor> = {}): Visitor => ({
  token,
  software: { device: "desktop", os: "macOS", browser: "Chrome" },
  country: "SG",
  region: "01",
  city: "Singapore",
  lang: "en",
  localHour: "21",
  localDay: "Thu",
  ...over,
});
const use = (e: Use["e"], extra: Omit<Use, "e"> = {}): Use => ({ e, ...extra });

describe("what can be counted", () => {
  it("takes only listed uses and sources", () => {
    expect(parseUse({ e: "review", s: "chesscom" })).toEqual({ e: "review", s: "chesscom" });
    expect(parseUse({ e: "review_done" })).toEqual({ e: "review_done" });
    expect(parseUse({ e: "get_extension", s: "header" })).toEqual({ e: "get_extension", s: "header" });
    expect(parseUse({ e: "import_error", s: "lichess.notfound" })).toEqual({ e: "import_error", s: "lichess.notfound" });
    expect(parseUse({ e: "review", s: "facebook" })).toBeNull();
    expect(parseUse({ e: "import_error", s: "lichess.hacked" })).toBeNull();
    expect(parseUse({ e: "purchase" })).toBeNull();
    expect(parseUse({ e: "toString" })).toBeNull();
    expect(parseUse({ e: "visit", s: 3 })).toBeNull();
    expect(parseUse("visit")).toBeNull();
    expect(parseUse(null)).toBeNull();
  });

  it("keeps the page as a page of the site, and the channel and device classes only from their lists", () => {
    expect(parseUse({ e: "visit", s: "direct", p: "/games/", c: "google", d: { vw: "lg", input: "mouse", theme: "dark-picked", cores: "5-8" } })).toEqual({
      e: "visit",
      s: "direct",
      p: "/games",
      c: "google",
      d: { vw: "lg", input: "mouse", theme: "dark-picked", cores: "5-8" },
    });
    // A shared review's id isn't kept; an address that isn't a page is "other".
    expect(parseUse({ e: "page", p: "/r/AbC123" })?.p).toBe("/r/*");
    expect(parseUse({ e: "page", p: "/wp-admin/login.php" })?.p).toBe("other");
    expect(parseUse({ e: "visit", c: "myspace" })).toBeNull();
    expect(parseUse({ e: "visit", d: { vw: "huge" } })).toBeNull();
    expect(parseUse({ e: "visit", d: { gpu: "rtx" } })).toBeNull();
    // Device classes only come with a visit; numbers only with what they measure.
    expect(parseUse({ e: "review", d: { vw: "lg" } })).toBeNull();
    expect(parseUse({ e: "review_done", s: "standard", n: 42 })).toEqual({ e: "review_done", s: "standard", n: 42 });
    expect(parseUse({ e: "review", n: 42 })).toBeNull();
    expect(parseUse({ e: "review_done", n: -1 })).toBeNull();
    expect(parseUse({ e: "review_done", n: 1.5 })).toBeNull();
  });

  it("takes a page-hide report: seconds per page (capped at an hour each) and page-speed numbers", () => {
    expect(parseUse({ e: "leave", t: { "/": 30, "/games/": 5, "/r/x": 2, "/r/y": 3 }, v: { LCP: 1840.5, CLS: 0.02 } })).toEqual({ e: "leave", t: { "/": 30, "/games": 5, "/r/*": 5 }, v: { LCP: 1840.5, CLS: 0.02 } });
    expect(parseUse({ e: "leave", t: { "/": 3601 } })).toBeNull();
    expect(parseUse({ e: "leave", v: { FID: 3 } })).toBeNull();
    expect(parseUse({ e: "leave", v: { LCP: Number.POSITIVE_INFINITY } })).toBeNull();
    expect(parseUse({ e: "visit", t: { "/": 3 } })).toBeNull();
  });
});

describe("the anonymous counter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps a visitor's token stable all month and unlinkable across months", () => {
    const a = visitorToken("secret", "2026-10", "203.0.113.7", "Firefox");
    expect(a).toBe(visitorToken("secret", "2026-10", "203.0.113.7", "Firefox"));
    expect(a).not.toBe(visitorToken("secret", "2026-11", "203.0.113.7", "Firefox"));
    expect(a).not.toBe(visitorToken("other", "2026-10", "203.0.113.7", "Firefox"));
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("writes a visit as hourly counts and sketches, and stores no addresses or tokens as values", async () => {
    const db = fakeDb();
    const t = at("2026-10-22T13:20:00Z");
    await recordUse(db, "use", t, use("visit", { s: "direct", c: "google", p: "/", d: { vw: "lg", input: "mouse", theme: "dark" } }), person("tok-1"));
    await recordUse(db, "use", t + 60_000, use("review", { s: "chesscom", c: "google", p: "/" }), person("tok-1"));
    const h = Object.fromEntries(db.hashes.get("use:2026-10-22:h")!);
    expect(h).toEqual({
      "13|e|visit|direct|google|/": 1,
      "13|g|SG|01|Singapore|en|21|Thu": 1,
      "13|t|desktop|macOS|Chrome|lg|mouse|dark|||||": 1,
      "13|e|review|chesscom|google|/": 1,
      // The first use of the day, by someone not seen earlier this month.
      "13|r|new": 1,
    });
    expect([...db.sets.keys()].sort()).toEqual(
      [
        "use:2026-10-22:seen",
        "use:m:2026-10:seen",
        "use:2026-10-22:who:visit",
        "use:2026-10-22:13:seen",
        "use:2026-10-22:13:who:visit",
        "use:live:29877920",
        "use:2026-10-22:new",
        "use:2026-10-22:who:review",
        "use:2026-10-22:13:who:review",
        "use:live:29877921",
      ].sort(),
    );
    expect([...db.expiring]).toEqual(["use:live:29877920", "use:live:29877921"]);
    const everything = JSON.stringify([...db.hashes].map(([k, v]) => [k, [...v]]));
    expect(everything).not.toContain("tok-1");
  });

  it("tells new people from people back on a later day of the month, once per day each", async () => {
    const db = fakeDb();
    const anna = person("anna");
    await recordUse(db, "use", at("2026-10-22T09:00:00Z"), use("visit"), anna);
    await recordUse(db, "use", at("2026-10-22T10:00:00Z"), use("visit"), anna);
    await recordUse(db, "use", at("2026-10-24T08:00:00Z"), use("visit"), anna);
    await recordUse(db, "use", at("2026-10-24T08:30:00Z"), use("page", { p: "/games" }), anna);
    expect(Object.fromEntries([...db.hashes.get("use:2026-10-22:h")!].filter(([f]) => f.includes("|r|")))).toEqual({ "09|r|new": 1 });
    expect(Object.fromEntries([...db.hashes.get("use:2026-10-24:h")!].filter(([f]) => f.includes("|r|")))).toEqual({ "08|r|back": 1 });
    expect(db.sets.get("use:2026-10-24:new")).toBeUndefined();
  });

  it("counts a page-hide report's seconds and speed ranges by device, without touching the sketches", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T13:00:00Z"), use("leave", { t: { "/": 75, "/games": 12 }, v: { LCP: 2600, CLS: 0.03, INP: 80 } }), person("x", { software: { device: "mobile", os: "iOS", browser: "Safari" } }));
    expect(Object.fromEntries(db.hashes.get("use:2026-10-22:h")!)).toEqual({ "13|s|/": 75, "13|s|/games": 12, "13|w|LCP|mobile|5": 1, "13|w|CLS|mobile|1": 1, "13|w|INP|mobile|1": 1 });
    expect(db.sets.size).toBe(0);
  });

  it("counts a finished review's depth and time", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T13:00:00Z"), use("review_done", { s: "thorough", n: 75 }), person("x"));
    expect(Object.fromEntries([...db.hashes.get("use:2026-10-22:h")!].filter(([f]) => /\|ds?\|/.test(f)))).toEqual({ "13|d|thorough|5": 1, "13|ds|thorough": 75 });
  });

  it("counts where an error happened, and takes only a kind and a place in the site's scripts", async () => {
    expect(parseUse({ e: "error", s: "page", x: "TypeError@0gij9ks01ahg.js:342:24176" })).toEqual({ e: "error", s: "page", x: "TypeError@0gij9ks01ahg.js:342:24176" });
    expect(parseUse({ e: "error", s: "script", x: "other" })).toEqual({ e: "error", s: "script", x: "other" });
    expect(parseUse({ e: "error", s: "page", x: "TypeError: Invalid move Nf3" })).toBeNull();
    expect(parseUse({ e: "error", s: "page", x: "TypeError@https://evil.example/a.js:1:2" })).toBeNull();
    expect(parseUse({ e: "review", s: "pgn", x: "Error" })).toBeNull();
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-26T09:00:00Z"), use("error", { s: "page", x: "TypeError@0gij9ks01ahg.js:342:24176" }), person("x"));
    expect([...db.hashes.get("use:2026-10-26:h")!.keys()].filter((f) => f.startsWith("09|x|"))).toEqual(["09|x|page|TypeError@0gij9ks01ahg.js:342:24176"]);
  });

  it("reads the daily counts kept before hourly counting in today's format", () => {
    expect(legacyFields({ visit: 5, "visit:direct": 3, "visit:extension": 1, "arrive:google": 2, arrive: 2, "country:SG": 4, review_done: 1 })).toEqual({
      "e|visit|direct||": 3,
      "e|visit|extension||": 1,
      "e|visit|||": 1,
      "e|arrive|google||": 2,
      "g|SG|||||": 4,
      "e|review_done|||": 1,
    });
    const d = dayFromRaw("2026-10-21", { "07|e|visit|direct||/": 2, "07|s|/": 40, junk: 9 }, { visit: 3 }, 2, 1, Array(24).fill(0), {});
    expect(d.fields).toEqual({ "e|visit|||": 3, "e|visit|direct||/": 2, "s|/": 40 });
    expect(d.hours[7]).toEqual({ visit: 2, time: 40 });
    expect(d.hourly).toBe(true);
  });

  it("rolls up finished days once, then reads them in one command", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T05:00:00Z"), use("visit", { s: "direct", p: "/" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T06:00:00Z"), use("visit", { s: "direct", p: "/" }), person("ben"));
    const first = await readDays(db, "use", ["2026-10-22", "2026-10-23"], "2026-10-23");
    expect(first.map((d) => [d.day, d.people, d.hourPeople[5], d.hourPeople[6], d.newPeople])).toEqual([
      ["2026-10-22", 1, 1, 0, 1],
      ["2026-10-23", 1, 0, 1, 1],
    ]);
    expect(db.strings.has("use:roll:2026-10-22")).toBe(true);
    expect(db.strings.has("use:roll:2026-10-23")).toBe(false); // today isn't finished
    // The finished day now comes from its roll-up even if its counts are gone.
    db.hashes.delete("use:2026-10-22:h");
    const again = await readDays(db, "use", ["2026-10-22"], "2026-10-23");
    expect(again[0].fields).toEqual(first[0].fields);
    expect(again[0].raw).toBeUndefined();
  });

  it("counts distinct people across days of a month once (the token is monthly)", async () => {
    const db = fakeDb();
    const K = usageKeys("use");
    await recordUse(db, "use", at("2026-10-22T05:00:00Z"), use("visit"), person("anna"));
    await recordUse(db, "use", at("2026-10-23T05:00:00Z"), use("visit"), person("anna"));
    await recordUse(db, "use", at("2026-10-23T06:00:00Z"), use("visit"), person("ben"));
    expect(await countPeople(db, [["2026-10-22", "2026-10-23"].map(K.seen), [], [K.seen("2026-10-23")]])).toEqual([2, 0, 2]);
  });

  it("reads a rolling window hour by hour, across midnight", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T23:10:00Z"), use("visit", { p: "/" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T00:05:00Z"), use("review", { s: "pgn", p: "/" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T00:40:00Z"), use("visit", { p: "/games" }), person("ben"));
    const w = await readHours(db, "use", at("2026-10-23T01:00:00Z"), 3);
    expect(w.hours.map((h) => [new Date(h.t).toISOString().slice(11, 13), h.people, h.metrics])).toEqual([
      ["22", 0, {}],
      ["23", 1, { visit: 1, new: 1 }],
      ["00", 2, { review: 1, visit: 1, new: 1, back: 1 }],
    ]);
    expect(w.people).toBe(2);
    expect(w.who).toMatchObject({ visit: 2, review: 1 });
    expect(w.engaged).toBe(1);
    expect(w.hours[2].fields).toMatchObject({ "e|review|pgn||/": 1 });
  });

  it("reads who came back within a month, from the day people were first seen", async () => {
    const db = fakeDb();
    for (const [day, who] of [
      ["2026-10-22", ["anna", "ben", "cara"]],
      ["2026-10-23", ["anna", "dan"]],
      ["2026-10-25", ["ben", "dan"]],
    ] as const)
      for (const p of who) await recordUse(db, "use", at(`${day}T10:00:00Z`), use("visit"), person(p));
    const r = await readRetention(db, "use", "2026-10", "2026-10-25");
    expect(r.people).toBe(4);
    expect(r.daily.map((d) => d.people)).toEqual([3, 2, 0, 2]);
    const [d22, d23, d24] = r.cohorts;
    expect([d22.size, d22.back.slice(0, 4), d22.later]).toEqual([3, [1, 0, 1, null], 2]);
    expect([d23.size, d23.back.slice(0, 3), d23.later]).toEqual([1, [0, 1, null], 1]);
    expect([d24.size, d24.later]).toEqual([0, 0]);
    // Only days of the month that are counted; nothing kept for an unfinished month.
    expect(db.strings.has("use:ret:2026-10")).toBe(false);
    const done = await readRetention(db, "use", "2026-10", "2026-11-02");
    expect(done.daily).toHaveLength(10);
    expect(db.strings.has("use:ret:2026-10")).toBe(true);
  });

  it("reads who's active right now", async () => {
    const db = fakeDb();
    const now = at("2026-10-22T13:30:30Z");
    await recordUse(db, "use", now - 2 * 60_000, use("visit", { p: "/" }), person("anna"));
    await recordUse(db, "use", now - 20 * 60_000, use("visit", { p: "/games" }), person("ben"));
    await recordUse(db, "use", now - 50 * 60_000, use("visit", { p: "/" }), person("cara"));
    const live = await readLive(db, "use", now);
    expect([live.last5, live.last30, live.last60]).toEqual([1, 2, 3]);
    expect(live.minutes).toHaveLength(30);
    expect(live.minutes.at(-3)!.people).toBe(1);
    expect(live.fields).toMatchObject({ "e|visit|||/": 2, "e|visit|||/games": 1 });
  });

  it("drops a day's hourly sketches in one go", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T13:00:00Z"), use("visit"), person("anna"));
    await forgetHours(db, "use", "2026-10-22");
    expect([...db.sets.keys()].filter((k) => /:\d\d:/.test(k) && !k.includes("live"))).toEqual([]);
    expect(db.sets.has("use:2026-10-22:seen")).toBe(true);
  });

  it("reads a hash whether the client hands it over as an object or as raw field/value pairs", () => {
    expect(countsOf({ visit: "3", review: 2 })).toEqual({ visit: 3, review: 2 });
    expect(countsOf(["visit", "3", "review:pgn", "1"])).toEqual({ visit: 3, "review:pgn": 1 });
    expect(countsOf(null)).toEqual({});
  });

  it("keeps production numbers apart from previews and local runs", () => {
    expect(keyPrefix("production")).toBe("use");
    expect(keyPrefix("preview")).toBe("use-preview");
    expect(keyPrefix(undefined)).toBe("use-local");
  });

  it("doesn't count crawlers, link previews, monitors or headless browsers", () => {
    expect(isAutomated("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isAutomated("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0 Safari/537.36")).toBe(true);
    expect(isAutomated("curl/8.4.0")).toBe(true);
    expect(isAutomated(null)).toBe(true);
    expect(isAutomated("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe(false);
    expect(isAutomated("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});

describe("the dashboard's reading", () => {
  it("sums a day period, its people, the period before (aligned by day) and every hour", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T09:00:00Z"), use("visit", { s: "direct", c: "google", p: "/" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T10:00:00Z"), use("visit", { s: "direct", c: "reddit", p: "/games" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T10:05:00Z"), use("review", { s: "lichess", c: "reddit", p: "/games" }), person("anna"));
    await recordUse(db, "use", at("2026-10-24T11:00:00Z"), use("visit", { s: "direct", p: "/" }), person("ben"));
    const now = at("2026-10-24T12:00:00Z");
    const d = await readDashboard(db, "use", periodOf({ range: "7d", unit: "day" }, now, "2026-10-14"), now);
    expect(d.points.map((p) => [new Date(p.t).toISOString().slice(0, 10), p.people, p.m.visit ?? 0])).toEqual([
      ["2026-10-18", 0, 0],
      ["2026-10-19", 0, 0],
      ["2026-10-20", 0, 0],
      ["2026-10-21", 0, 0],
      ["2026-10-22", 1, 1],
      ["2026-10-23", 1, 1],
      ["2026-10-24", 1, 1],
    ]);
    expect(d.prevPoints.map((p) => new Date(p.t).toISOString().slice(0, 10))).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(d.people).toBe(2);
    expect(d.who).toMatchObject({ visit: 2, review: 1 });
    expect(d.engaged).toBe(1);
    // Both were first seen this month within the period: nobody came back from before it.
    expect([d.newcomers, d.tracked]).toEqual([2, 2]);
    expect(d.totals.channels).toEqual({ google: { visit: 1 }, reddit: { visit: 1, review: 1 } });
    expect(d.totals.pages["/games"]).toEqual({ visit: 1, views: 1, review: 1 });
    expect(d.hourly.map((h) => new Date(h.t).toISOString().slice(0, 13))).toEqual(["2026-10-22T09", "2026-10-23T10", "2026-10-24T11"]);
    // Weeks: their people are counted as one group each.
    const w = await readDashboard(db, "use", periodOf({ range: "30d", unit: "week" }, now, "2026-10-14"), now);
    expect(w.points.map((p) => [new Date(p.t).toISOString().slice(0, 10), p.people])).toEqual([
      ["2026-10-12", 0],
      ["2026-10-19", 2],
    ]);
  });

  it("reads a rolling window and the one before it", async () => {
    const db = fakeDb();
    await recordUse(db, "use", at("2026-10-22T09:00:00Z"), use("visit", { p: "/" }), person("anna"));
    await recordUse(db, "use", at("2026-10-23T08:00:00Z"), use("visit", { p: "/" }), person("ben"));
    const now = at("2026-10-23T09:30:00Z");
    const d = await readDashboard(db, "use", periodOf({ range: "24h" }, now, "2026-10-14"), now);
    expect(d.points).toHaveLength(24);
    expect(d.people).toBe(1);
    expect(d.prevPeople).toBe(1);
    expect(d.prevPoints.map((p) => p.t)).toEqual(d.points.map((p) => p.t - 86_400_000));
    expect(d.prevPoints.find((p) => p.m.visit)?.t).toBe(at("2026-10-22T09:00:00Z"));
  });
});

describe("games reviewed, for the home page", () => {
  it("counts every review started, not shared or published reviews opened, live from one counter", async () => {
    const { readReviewTotal } = await import("./reviewTotal");
    expect(isGameReview("e|review|chesscom|google|/")).toBe(true);
    expect(isGameReview("e|review|pgn||")).toBe(true);
    expect(isGameReview("e|review|link|none|/r/*")).toBe(false);
    expect(isGameReview("e|review|link|none|/games/a-vs-b-2026-10-20/review")).toBe(false);
    expect(isGameReview("e|review_done|standard|none|/review")).toBe(false);

    const db = fakeDb();
    // A day from before hourly counting, in its old daily form.
    db.hashes.set("use:2026-10-15:n", new Map([["review", 3], ["review:pgn", 2], ["visit", 9]]));
    await recordUse(db, "use", at("2026-10-24T10:00:00Z"), use("review", { s: "chesscom", p: "/" }), person("a"));
    await recordUse(db, "use", at("2026-10-25T23:59:00Z"), use("review", { s: "extension", p: "/" }), person("b"));
    await recordUse(db, "use", at("2026-10-25T08:00:00Z"), use("review", { s: "link", p: "/r/*" }), person("b"));
    await recordUse(db, "use", at("2026-10-25T08:00:00Z"), use("review", { s: "link", p: "/games/a-vs-b-2026-10-20/review" }), person("b"));
    await recordUse(db, "use", at("2026-10-26T01:00:00Z"), use("review", { s: "pgn", p: "/pgn-analyzer" }), person("c"));
    await recordUse(db, "use", at("2026-10-26T02:00:00Z"), use("review_done", { s: "standard", p: "/review" }), person("c"));

    // Each game review counted adds one to the running total; the rest don't.
    expect(db.strings.get("use:reviews")).toBe("3");
    // The first read sets what came before the counter (the old daily form's 3), once.
    expect(await readReviewTotal(db, "use", at("2026-10-26T12:00:00Z"))).toBe(3 + 1 + 1 + 1);
    expect(db.strings.get("use:reviews:base")).toBe("3");
    expect(await db.set("use:reviews:base", "999", { nx: true })).toBeNull();
    // Then every read is the counter and that base, in one command.
    await recordUse(db, "use", at("2026-10-26T13:00:00Z"), use("review", { s: "lichess", p: "/" }), person("d"));
    const hgetalls = db.calls.hgetall;
    const mgets = db.calls.mget;
    expect(await readReviewTotal(db, "use", at("2026-10-26T13:30:00Z"))).toBe(7);
    expect([db.calls.mget - mgets, db.calls.hgetall - hgetalls]).toEqual([1, 0]);
  });
});

describe("the outside numbers", () => {
  it("reads the extension's users and rating from its store page", () => {
    const html = '<div class="F9iKBc">5 out of 5 stars</div><span>3 ratings</span><div>Featured</div><div>1,234 users</div>';
    expect(readStorePage(html)).toEqual({ users: 1234, rating: 5, ratings: 3 });
    expect(readStorePage("<html>nothing</html>")).toBeUndefined();
  });
});

describe("the dashboard password", () => {
  const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  it("lets in the right password with any user name, and nothing else", () => {
    expect(statsAllowed(basic("owner", "correct horse"), "correct horse")).toBe(true);
    expect(statsAllowed(basic("", "correct horse"), "correct horse")).toBe(true);
    expect(statsAllowed(basic("owner", "correct horse "), "correct horse")).toBe(false);
    expect(statsAllowed(basic("owner", "wrong"), "correct horse")).toBe(false);
    expect(statsAllowed("Bearer correct horse", "correct horse")).toBe(false);
    expect(statsAllowed(null, "correct horse")).toBe(false);
    // Without a password set, the dashboard is closed to everyone.
    expect(statsAllowed(basic("owner", ""), "")).toBe(false);
    expect(statsAllowed(basic("owner", "x"), undefined)).toBe(false);
  });
});
