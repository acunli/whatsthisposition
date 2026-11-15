import { describe, expect, it } from "vitest";
import { MIN_PERFORMANCE_MOVES, accuracyLevel, expectedAccuracy, performanceRatings, timeClassOf, type TimeClass } from "./performance";

const CLASSES: TimeClass[] = ["bullet", "blitz", "rapid", "daily"];
const plenty = { w: 30, b: 30 };

describe("performance rating", () => {
  it("expects more accuracy from higher ratings, in every time class", () => {
    for (const tc of CLASSES) for (let r = 200; r < 3200; r += 100) expect(expectedAccuracy(r + 100, tc)).toBeGreaterThan(expectedAccuracy(r, tc));
  });

  it("reads the curve backwards: the level of a rating's usual accuracy is that rating", () => {
    for (const tc of CLASSES) for (const r of [300, 650, 900, 1500, 2400, 3000]) expect(accuracyLevel(expectedAccuracy(r, tc), tc)).toBeCloseTo(r, 6);
  });

  it("gives the rating back for a game played as accurately as that rating usually plays", () => {
    for (const r of [600, 1000, 1500, 2000]) {
      const a = expectedAccuracy(r, "rapid");
      const p = performanceRatings({ accuracy: { w: a, b: a }, scored: plenty, whiteElo: String(r), blackElo: String(r), headers: { TimeControl: "600" } });
      expect(p.w).toBe(Math.round(r / 50) * 50);
      expect(p.b).toBe(Math.round(r / 50) * 50);
    }
  });

  it("moves above the rating for a better game and below it for a worse one, by part of the gap only", () => {
    const usual = expectedAccuracy(1500, "blitz");
    const p = performanceRatings({ accuracy: { w: usual + 10, b: usual - 10 }, scored: plenty, whiteElo: "1500", blackElo: "1500", headers: { TimeControl: "180" } });
    expect(p.w!).toBeGreaterThan(1500);
    expect(p.b!).toBeLessThan(1500);
    expect(p.w!).toBeLessThan(accuracyLevel(usual + 10, "blitz"));
    expect(p.b!).toBeGreaterThan(accuracyLevel(usual - 10, "blitz"));
  });

  it("the same accuracy means more from a higher-rated player", () => {
    const at = (elo: string) => performanceRatings({ accuracy: { w: 85, b: 85 }, scored: plenty, whiteElo: elo, blackElo: elo, headers: { TimeControl: "600" } }).w!;
    expect(at("2200")).toBeGreaterThan(at("1200"));
  });

  it("stays inside the ratings that exist, in steps of 50", () => {
    const top = performanceRatings({ accuracy: { w: 100, b: 0 }, scored: plenty, whiteElo: "3200", blackElo: "150", headers: { TimeControl: "60" } });
    expect(top.w).toBeLessThanOrEqual(3300);
    expect(top.b).toBeGreaterThanOrEqual(100);
    expect(top.w! % 50).toBe(0);
    expect(top.b! % 50).toBe(0);
  });

  it("says nothing about a side with too few moves to judge", () => {
    const p = performanceRatings({ accuracy: { w: 90, b: 70 }, scored: { w: MIN_PERFORMANCE_MOVES - 1, b: MIN_PERFORMANCE_MOVES }, whiteElo: "1500", blackElo: "1500", headers: {} });
    expect(p.w).toBeNull();
    expect(p.b).not.toBeNull();
    expect(performanceRatings({ accuracy: { w: null, b: null }, scored: plenty, headers: {} })).toEqual({ w: null, b: null });
  });

  it("without ratings, starts from the level of the game itself", () => {
    const p = performanceRatings({ accuracy: { w: 88, b: 64 }, scored: plenty, headers: {} });
    const mid = (accuracyLevel(88, "rapid") + accuracyLevel(64, "rapid")) / 2;
    expect(p.w!).toBeGreaterThan(mid);
    expect(p.b!).toBeLessThan(mid);
    // The same game with one rating known: the unrated side is compared with its opponent's rating.
    const q = performanceRatings({ accuracy: { w: 88, b: 64 }, scored: plenty, blackElo: "1200", headers: {} });
    expect(q.w!).toBeGreaterThan(1200);
    expect(q.b!).toBeLessThan(1200);
  });

  it("sorts games into Chess.com's time classes", () => {
    expect(timeClassOf({ TimeControl: "60" })).toBe("bullet");
    expect(timeClassOf({ TimeControl: "120+1" })).toBe("bullet");
    expect(timeClassOf({ TimeControl: "180" })).toBe("blitz");
    expect(timeClassOf({ TimeControl: "180+2" })).toBe("blitz");
    expect(timeClassOf({ TimeControl: "600" })).toBe("rapid");
    expect(timeClassOf({ TimeControl: "900+10" })).toBe("rapid");
    expect(timeClassOf({ TimeControl: "1/86400" })).toBe("daily");
    expect(timeClassOf({})).toBe("rapid");
    expect(timeClassOf({ TimeControl: "-", Event: "Rated correspondence game" })).toBe("daily");
  });

  it("puts a Lichess game's level on Lichess's scale before comparing it with a Lichess rating", () => {
    const usual = expectedAccuracy(1300, "rapid");
    const base = { accuracy: { w: usual, b: usual }, scored: plenty, whiteElo: "1500", blackElo: "1500" };
    const lichess = performanceRatings({ ...base, headers: { TimeControl: "600", Site: "https://lichess.org/abcdefgh" } });
    const chesscom = performanceRatings({ ...base, headers: { TimeControl: "600", Site: "Chess.com" } });
    expect(lichess.w).toBe(1500);
    expect(chesscom.w!).toBeLessThan(1500);
  });
});
