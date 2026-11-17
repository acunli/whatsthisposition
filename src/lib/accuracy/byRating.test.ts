import { describe, expect, it } from "vitest";
import { onePerformance, performanceRatings } from "../review/performance";
import { ACCURACY_CLASSES, ACCURACY_DATA, ACCURACY_TEXT, at, bandFor, bandLabel, bandsOf, medianOf, percentileIn } from "./byRating";

describe("accuracy by rating", () => {
  it("has ordered bands with rising percentiles in every time class", () => {
    for (const tc of ACCURACY_CLASSES) {
      const bands = bandsOf(tc);
      expect(bands.length, tc).toBeGreaterThan(5);
      for (const b of bands) {
        expect(b.n).toBeGreaterThanOrEqual(ACCURACY_DATA.minGames);
        expect(b.p).toHaveLength(ACCURACY_DATA.percentiles.length);
        for (let i = 1; i < b.p.length; i++) expect(b.p[i]).toBeGreaterThanOrEqual(b.p[i - 1]);
      }
      for (let i = 1; i < bands.length; i++) expect(bands[i].from).toBeGreaterThan(bands[i - 1].from);
      // Stronger players are more accurate: the median rises from the first band to the last.
      expect(medianOf(bands.at(-1)!)).toBeGreaterThan(medianOf(bands[0]) + 10);
    }
  });

  it("finds a rating's band, and none where the data has a gap", () => {
    expect(bandLabel(bandFor("rapid", 150)!)).toBe("under 400");
    expect(bandLabel(bandFor("rapid", 1000)!)).toBe("1000–1199");
    expect(bandLabel(bandFor("rapid", 1199)!)).toBe("1000–1199");
    const blitz = bandsOf("blitz");
    const gap = blitz.findIndex((b, i) => i > 0 && blitz[i - 1].to !== b.from);
    if (gap > 0) expect(bandFor("blitz", blitz[gap - 1].to!)).toBeNull();
  });

  it("reads a game's percentile between the stored ones", () => {
    const b = bandFor("rapid", 1100)!;
    expect(percentileIn(b, medianOf(b))).toEqual({ pct: 50, edge: null });
    expect(percentileIn(b, at(b, 75))).toEqual({ pct: 75, edge: null });
    const mid = percentileIn(b, (at(b, 25) + at(b, 30)) / 2);
    expect(mid.pct).toBeGreaterThanOrEqual(26);
    expect(mid.pct).toBeLessThanOrEqual(29);
    expect(percentileIn(b, 100).edge).toBe("above");
    expect(percentileIn(b, 0).edge).toBe("below");
  });

  it("states the data's own numbers in its answers", () => {
    const b = bandFor("rapid", 1100)!;
    expect(ACCURACY_TEXT.good).toContain(medianOf(b).toFixed(1));
    expect(ACCURACY_TEXT.lost).toContain(b.won!.toFixed(1));
    expect(ACCURACY_TEXT.lost).toContain(b.lost!.toFixed(1));
    expect(ACCURACY_TEXT.club).toContain(medianOf(bandFor("rapid", 1500)!).toFixed(1));
  });

  it("gives the calculator the review's performance rating", () => {
    const fromGame = performanceRatings({ accuracy: { w: 81.2, b: 70 }, scored: { w: 30, b: 30 }, whiteElo: "1200", blackElo: "1250", headers: { TimeControl: "600" } });
    expect(onePerformance(1200, 81.2, "rapid")).toBe(fromGame.w);
    expect(onePerformance(1200, 81.2, "rapid")).toBeGreaterThan(1200);
    expect(onePerformance(1200, 60, "rapid")).toBeLessThan(1200);
  });
});
