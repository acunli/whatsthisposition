import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUse } from "../usage";

vi.mock("server-only", () => ({}));
const { countsOf, dayRange, isAutomated, keyPrefix, readUsage, recordUse, visitorToken } = await import("./usage");
const { statsAllowed } = await import("./statsAuth");
type Db = import("./usage").UsageDb;
type Pipe = import("./usage").UsagePipe;

/** An in-memory stand-in for the Redis commands the counter uses (HyperLogLogs as exact sets). */
function fakeDb() {
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, number>>();
  const db: Db & { sets: typeof sets; hashes: typeof hashes } = {
    sets,
    hashes,
    pipeline() {
      const ops: (() => unknown)[] = [];
      const p: Pipe = {
        pfadd: (key, member) => (ops.push(() => (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(member)), p),
        pfcount: (...keys) => (ops.push(() => new Set(keys.flatMap((k) => [...(sets.get(k) ?? [])])).size), p),
        hincrby: (key, field, by) => (ops.push(() => {
          const h = hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
          h.set(field, (h.get(field) ?? 0) + by);
        }), p),
        hgetall: (key) => (ops.push(() => (hashes.has(key) ? Object.fromEntries(hashes.get(key)!) : null)), p),
        exec: async () => ops.map((f) => f()),
      };
      return p;
    },
  };
  return db;
}

describe("what can be counted", () => {
  it("takes only listed uses and sources", () => {
    expect(parseUse({ e: "review", s: "chesscom" })).toEqual({ e: "review", s: "chesscom" });
    expect(parseUse({ e: "review_done" })).toEqual({ e: "review_done" });
    expect(parseUse({ e: "review", s: "facebook" })).toBeNull();
    expect(parseUse({ e: "purchase" })).toBeNull();
    expect(parseUse({ e: "toString" })).toBeNull();
    expect(parseUse({ e: "visit", s: 3 })).toBeNull();
    expect(parseUse("visit")).toBeNull();
    expect(parseUse(null)).toBeNull();
  });
});

describe("the anonymous counter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps a visitor's daily token stable all day and unlinkable across days", () => {
    const a = visitorToken("secret", "2026-10-14", "203.0.113.7", "Firefox");
    expect(a).toBe(visitorToken("secret", "2026-10-14", "203.0.113.7", "Firefox"));
    expect(a).not.toBe(visitorToken("secret", "2026-10-15", "203.0.113.7", "Firefox"));
    expect(a).not.toBe(visitorToken("other", "2026-10-14", "203.0.113.7", "Firefox"));
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("stores no addresses or tokens as values: only sketches of visitors and counts", async () => {
    const db = fakeDb();
    await recordUse(db, "use", "2026-10-14", "visit", "direct", "tok-1", "SG");
    await recordUse(db, "use", "2026-10-14", "review", "chesscom", "tok-1");
    expect([...db.sets.keys()].sort()).toEqual(["use:2026-10-14:seen", "use:2026-10-14:who:review", "use:2026-10-14:who:visit"]);
    expect(Object.fromEntries(db.hashes.get("use:2026-10-14:n")!)).toEqual({ visit: 1, "visit:direct": 1, "country:SG": 1, review: 1, "review:chesscom": 1 });
    // A country only counts for visits, and only as a two-letter code.
    await recordUse(db, "use", "2026-10-14", "visit", "direct", "tok-2", "<script>");
    expect(db.hashes.get("use:2026-10-14:n")!.get("visit")).toBe(2);
    expect([...db.hashes.get("use:2026-10-14:n")!.keys()].filter((k) => k.startsWith("country:"))).toEqual(["country:SG"]);
  });

  it("reads people per day, people over the range, the range before, and totals", async () => {
    const db = fakeDb();
    const days = dayRange("2026-10-14", 3);
    expect(days).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    // The same person on two days counts once over the range; a review counts for its source.
    await recordUse(db, "use", "2026-10-12", "visit", "direct", "anna-12");
    await recordUse(db, "use", "2026-10-13", "visit", "direct", "anna-13");
    await recordUse(db, "use", "2026-10-13", "visit", "extension", "ben-13");
    await recordUse(db, "use", "2026-10-13", "review", "extension", "ben-13");
    await recordUse(db, "use", "2026-10-14", "review", "pgn", "anna-14");
    await recordUse(db, "use", "2026-10-09", "visit", "direct", "cara-9"); // in the range before
    const r = await readUsage(db, "use", 3, "2026-10-14");
    expect(r.days.map((d) => d.visitors)).toEqual([1, 2, 0]);
    expect(r.visitors).toBe(3); // daily tokens: anna on two days looks like two (that's the privacy trade)
    expect(r.previousVisitors).toBe(1);
    expect(r.people.review).toBe(2);
    expect(r.totals).toMatchObject({ visit: 3, review: 2, "review:extension": 1, "review:pgn": 1, "visit:extension": 1 });
    expect(r.days[2].n).toEqual({ review: 1, "review:pgn": 1 });
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
