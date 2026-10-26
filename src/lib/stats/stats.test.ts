import { describe, expect, it } from "vitest";
import { LANDING } from "../landing";
import { ERROR_WHERE, SITE_PAGES, VITALS, bucketOf, errorWhere, field, pagePath } from "./fields";
import { groupDays, periodOf, weekOf } from "./period";
import { breakdown, quantile, ranked, ratings } from "./report";
import { cityName, languageOf, localClock, software } from "./visitor";

describe("pages", () => {
  it("keeps the site's pages, groups shared reviews, keeps reviewed games, and calls anything else other", () => {
    for (const l of Object.values(LANDING)) expect(SITE_PAGES).toContain(l.path);
    expect(pagePath("/")).toBe("/");
    expect(pagePath("/review")).toBe("/review");
    expect(pagePath("/pgn-analyzer/")).toBe("/pgn-analyzer");
    expect(pagePath("/r/7fGh2K")).toBe("/r/*");
    expect(pagePath("/r/*")).toBe("/r/*");
    expect(pagePath("/games/magnus-carlsen-vs-hikaru-nakamura-2026-10-20")).toBe("/games/magnus-carlsen-vs-hikaru-nakamura-2026-10-20");
    expect(pagePath("/games/some-game/review")).toBe("/games/some-game/review");
    expect(pagePath("/games/Some_Game")).toBe("other");
    expect(pagePath("/stats")).toBe("other");
    expect(pagePath("/.env")).toBe("other");
  });

  it("writes fields whose parts can't break out of their place", () => {
    expect(field("e", "review", "chesscom", undefined, "/")).toBe("e|review|chesscom||/");
    expect(field("g", "SG", "a|b")).toBe("g|SG|ab");
  });
});

describe("the request's visitor classes", () => {
  const ua = {
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    tablet: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
    firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36",
    instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
    chromebook: "Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  };

  it("reads the device type, system and browser", () => {
    expect(software(ua.mac)).toEqual({ device: "desktop", os: "macOS", browser: "Chrome" });
    expect(software(ua.mac, null, "touch")).toEqual({ device: "tablet", os: "iPadOS", browser: "Chrome" });
    expect(software(ua.iphone)).toEqual({ device: "mobile", os: "iOS", browser: "Safari" });
    expect(software(ua.android)).toEqual({ device: "mobile", os: "Android", browser: "Chrome" });
    expect(software(ua.tablet)).toEqual({ device: "tablet", os: "Android", browser: "Chrome" });
    expect(software(ua.edge)).toEqual({ device: "desktop", os: "Windows", browser: "Edge" });
    expect(software(ua.firefox)).toEqual({ device: "desktop", os: "Linux", browser: "Firefox" });
    expect(software(ua.samsung).browser).toBe("Samsung Internet");
    expect(software(ua.instagram).browser).toBe("In-app browser");
    expect(software(ua.chromebook).os).toBe("ChromeOS");
    expect(software(ua.tablet, "?1").device).toBe("mobile");
  });

  it("keeps a city's name, the first language and the visitor's own clock", () => {
    expect(cityName("Z%C3%BCrich")).toBe("Zürich");
    expect(cityName("%3Cscript%3E")).toBe("script");
    expect(cityName("%E0%A4%A")).toBe("");
    expect(cityName(null)).toBe("");
    expect(languageOf("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt");
    expect(languageOf("*")).toBe("");
    expect(languageOf(null)).toBe("");
    expect(localClock(Date.parse("2026-10-22T13:20:00Z"), "Asia/Singapore")).toEqual({ hour: "21", day: "Thu" });
    expect(localClock(Date.parse("2026-10-22T13:20:00Z"), "America/Los_Angeles")).toEqual({ hour: "06", day: "Thu" });
    expect(localClock(Date.parse("2026-10-22T13:20:00Z"), "Not/AZone")).toEqual({ hour: "", day: "" });
  });
});

describe("periods", () => {
  const now = Date.parse("2026-10-24T13:20:00Z");

  it("reads rolling windows, day ranges since counting began, custom ranges and the old ?days=", () => {
    const h = periodOf({ range: "24h" }, now, "2026-10-14");
    expect([h.rolling, h.hours, h.unit, h.end]).toEqual([true, 24, "hour", Date.parse("2026-10-24T14:00:00Z")]);
    const w = periodOf({ range: "7d" }, now, "2026-10-14");
    expect([w.days[0], w.days.at(-1), w.days.length, w.unit, w.units]).toEqual(["2026-10-18", "2026-10-24", 7, "hour", ["hour", "day"]]);
    expect(w.prevDays).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    const m = periodOf({ range: "90d", unit: "week" }, now, "2026-10-14");
    expect([m.days[0], m.days.length, m.unit, m.hours]).toEqual(["2026-10-14", 11, "week", 90 * 24]);
    expect(periodOf({ range: "90d", unit: "hour" }, now, "2026-10-14").unit).toBe("day");
    const all = periodOf({ range: "all" }, now, "2026-10-14");
    expect([all.days[0], all.days.length, all.label]).toEqual(["2026-10-14", 11, "All time"]);
    const c = periodOf({ range: "custom", from: "2026-10-30", to: "2026-10-20" }, now, "2026-10-14");
    expect([c.key, c.from, c.to, c.days.length]).toEqual(["custom", "2026-10-20", "2026-10-24", 5]);
    expect(periodOf({ range: "custom", from: "junk", to: "2026-10-20" }, now, "2026-10-14").key).toBe("30d");
    expect(periodOf({ days: "7" }, now, "2026-10-14").key).toBe("7d");
    expect(periodOf({}, now, "2026-10-14").key).toBe("30d");
  });

  it("groups days into Monday weeks and calendar months", () => {
    expect(weekOf("2026-10-25")).toBe("2026-10-19");
    expect(weekOf("2026-10-19")).toBe("2026-10-19");
    expect(groupDays(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], "week").map((g) => [g.key, g.days.length])).toEqual([
      ["2026-10-26", 3],
      ["2026-11-02", 1],
    ]);
    expect(groupDays(["2026-10-31", "2026-11-01"], "month").map((g) => [g.key, new Date(g.start).toISOString().slice(0, 10)])).toEqual([
      ["2026-10", "2026-10-01"],
      ["2026-11", "2026-11-01"],
    ]);
  });
});

describe("reading the counts back", () => {
  it("sorts every kind of field into its table", () => {
    const b = breakdown(
      {
        "e|visit|direct|google|/": 3,
        "e|page||google|/games": 2,
        "e|review|chesscom|google|/": 1,
        "e|arrive|reddit||": 4,
        "e|visit|||": 5,
        "g|SG|01|Singapore|en|21|Thu": 3,
        "t|mobile|iOS|Safari|xs|touch|dark|5-8||4g|browser|3": 2,
        "s|/": 90,
        "w|LCP|mobile|2": 1,
        "w|LCP|desktop|7": 1,
        "d|standard|3": 2,
        "ds|standard": 70,
        "r|new": 2,
        "r|back": 1,
        "x|page|TypeError@0gij9ks01ahg.js:342:24176": 2,
      },
      { "e|visit|direct|google|/": 1 },
    );
    expect(b.events).toEqual({ visit: 9, page: 2, review: 1, arrive: 4 });
    expect(b.sources.visit).toEqual({ direct: 4 });
    expect(b.channels).toEqual({ google: { visit: 4, page: 2, review: 1 }, reddit: { visit: 4 } });
    expect(b.pages["/"]).toEqual({ visit: 4, views: 4, review: 1, time: 90 });
    expect(b.pages["/games"]).toEqual({ page: 2, views: 2 });
    expect([b.countries, b.regions, b.cities, b.languages, b.localDays, b.localHours[21]]).toEqual([{ SG: 3 }, { "SG|01": 3 }, { "SG|Singapore": 3 }, { en: 3 }, { Thu: 3 }, 3]);
    expect(b.tech.device).toEqual({ mobile: 2 });
    expect(b.tech.browser).toEqual({ Safari: 2 });
    expect(b.tech.cores).toEqual({ "5-8": 2 });
    expect(b.tech.mem).toEqual({});
    expect(b.tech.dpr).toEqual({ "3": 2 });
    expect(b.time).toBe(90);
    expect(b.vitals.LCP.all[2]).toBe(1);
    expect(b.vitals.LCP.byDevice.desktop[7]).toBe(1);
    expect(b.reviewTime.standard).toMatchObject({ count: 2, seconds: 70 });
    expect(b.returning).toEqual({ new: 2, back: 1 });
    expect(b.errorsAt).toEqual({ page: { "TypeError@0gij9ks01ahg.js:342:24176": 2 } });
  });

  it("finds where an error happened in the site's own scripts, and never keeps its message", () => {
    const origin = "https://www.whatsthisposition.com";
    const chrome = new TypeError("Cannot read properties of undefined (reading 'lines')");
    chrome.stack = `TypeError: Cannot read properties of undefined (reading 'lines')\n    at chrome-extension://abc/inject.js:1:2\n    at uU (${origin}/_next/static/chunks/00gij9ks01ahg.js:342:24176)\n    at h (${origin}/_next/static/chunks/0zz.js:1:5)`;
    expect(errorWhere(chrome, origin)).toBe("TypeError@00gij9ks01ahg.js:342:24176");
    const safari = new RangeError("Invalid move: e9");
    safari.stack = `uU@${origin}/_next/static/chunks/0abc.js:7:99\nh@${origin}/_next/static/chunks/0zz.js:1:5`;
    expect(errorWhere(safari, origin)).toBe("RangeError@0abc.js:7:99");
    expect(errorWhere(Object.assign(new Error("x"), { stack: "at https://elsewhere.example/_next/static/chunks/a.js:1:1" }), origin)).toBe("Error");
    expect(errorWhere("a thrown string", origin)).toBe("other");
    for (const w of ["TypeError@00gij9ks01ahg.js:342:24176", "RangeError@0abc.js:7:99", "Error", "other"]) expect(ERROR_WHERE.test(w)).toBe(true);
  });

  it("estimates percentiles within their range and splits loads into good, needs improvement and poor exactly", () => {
    const lcp = Array(VITALS.LCP.bounds.length + 1).fill(0);
    lcp[bucketOf(VITALS.LCP.bounds, 900)] = 6; // up to 1 s
    lcp[bucketOf(VITALS.LCP.bounds, 3500)] = 3; // 3–4 s
    lcp[bucketOf(VITALS.LCP.bounds, 12000)] = 1; // over 10 s
    expect(ratings("LCP", lcp)).toEqual({ good: 6, fair: 3, poor: 1 });
    const p75 = quantile(lcp, VITALS.LCP.bounds)!;
    expect(p75).toBeGreaterThan(3000);
    expect(p75).toBeLessThan(4000);
    expect(quantile(lcp, VITALS.LCP.bounds, 0.5)).toBeLessThanOrEqual(1000);
    expect(quantile(Array(10).fill(0), VITALS.LCP.bounds)).toBeNull();
    expect(bucketOf(VITALS.CLS.bounds, 0.1)).toBe(2);
    expect(bucketOf(VITALS.CLS.bounds, 5)).toBe(VITALS.CLS.bounds.length);
  });

  it("ranks rows and folds the tail into Other", () => {
    expect(ranked({ a: 1, b: 5, c: 0, d: 3 })).toEqual([
      { key: "b", value: 5 },
      { key: "d", value: 3 },
      { key: "a", value: 1 },
    ]);
    expect(ranked({ a: 1, b: 5, d: 3, e: 2 }, 3)).toEqual([
      { key: "b", value: 5 },
      { key: "d", value: 3 },
      { key: "Other", value: 3 },
    ]);
  });
});
