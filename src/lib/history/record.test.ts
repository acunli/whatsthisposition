import { describe, expect, it } from "vitest";
import { parseGame } from "../review/pgn";
import type { ClassifiedMove, MoveClass } from "../review/classify";
import type { GameReview } from "../review/review";
import { buildRecord, gameIdOf, summarise, upsert } from "./record";
import type { HistoryRecord } from "./types";

const PGN = '[Event "Casual game"]\n[Site "Somewhere"]\n[Date "2026.11.01"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n[WhiteElo "1800"]\n[BlackElo "1750"]\n[Opening "Ruy Lopez"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n';

/** The same game with the headers in another order, comments, and clock annotations. */
const SAME_PGN =
  '[Black "Ben"]\n[White "Ada"]\n[Result "1-0"]\n[Date "2026.11.01"]\n[WhiteElo "1800"]\n[Opening "Ruy Lopez"]\n[Site "Somewhere"]\n[BlackElo "1750"]\n[Event "Casual game"]\n\n1. e4 {a comment} e5 {[%clk 0:03:00.0]} 2. Nf3 Nc6 3. Bb5 a6 1-0\n';

/** A review of label counts alone: enough of one for `summarise` and `tally` to work with. */
function fakeReview(entries: [MoveClass, "w" | "b"][]): GameReview {
  const moves = entries.map(([cls, color]) => ({ cls, move: { color } }) as ClassifiedMove);
  return { moves, bookUntil: -1, opening: { eco: "C60", name: "Ruy Lopez" }, masters: null };
}

const REVIEW = fakeReview([
  ["brilliant", "w"],
  ["blunder", "w"],
  ["blunder", "b"],
  ["mistake", "b"],
]);

const NOW = 1_760_000_000_000;

function record(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    v: 1,
    id: "0".repeat(32),
    pgn: PGN,
    depth: 14,
    data: "packed",
    reviewedAt: NOW,
    lastOpenedAt: NOW,
    summary: {
      white: "Ada",
      black: "Ben",
      whiteElo: "1800",
      blackElo: "1750",
      result: "1-0",
      playedOn: "2026.11.01",
      site: "Somewhere",
      opening: { eco: "C60", name: "Ruy Lopez" },
      plies: 6,
      accuracy: { w: 88.1, b: 72.4 },
      counts: { blunder: { w: 1, b: 1 } },
    },
    ...overrides,
  };
}

describe("a history record's id", () => {
  it("is the same for the same game, however it is written", async () => {
    expect(await gameIdOf(parseGame(SAME_PGN))).toBe(await gameIdOf(parseGame(PGN)));
  });

  it("differs between games", async () => {
    expect(await gameIdOf(parseGame(PGN))).not.toBe(await gameIdOf(parseGame(PGN.replace("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", "1. d4 d5 2. c4 e6 3. Nc3 Nf6"))));
  });
});

describe("a record's summary", () => {
  it("matches the review's own labels", () => {
    const game = parseGame(PGN);
    const summary = summarise(game, REVIEW, { w: 88.1, b: 72.4 });
    expect(summary.white).toBe("Ada");
    expect(summary.black).toBe("Ben");
    expect(summary.result).toBe("1-0");
    expect(summary.playedOn).toBe("2026.11.01");
    expect(summary.opening).toEqual({ eco: "C60", name: "Ruy Lopez" });
    expect(summary.plies).toBe(6);
    expect(summary.accuracy).toEqual({ w: 88.1, b: 72.4 });
    expect(summary.counts).toEqual({ brilliant: { w: 1, b: 0 }, blunder: { w: 1, b: 1 }, mistake: { w: 0, b: 1 } });
  });

  it("falls back to the PGN's opening and no accuracy without a review", () => {
    const summary = summarise(parseGame(PGN), null, { w: null, b: null });
    expect(summary.opening).toEqual({ eco: "", name: "Ruy Lopez" });
    expect(summary.accuracy).toEqual({ w: null, b: null });
    expect(summary.counts).toEqual({});
  });
});

describe("building a record", () => {
  it("ids it from its PGN and stamps both times", async () => {
    const rec = await buildRecord({ game: parseGame(PGN), as: "w", depth: 14, data: "packed", review: REVIEW, accuracy: { w: 88.1, b: 72.4 }, now: NOW });
    expect(rec.id).toBe(await gameIdOf(parseGame(PGN)));
    expect(rec.v).toBe(1);
    expect(rec.depth).toBe(14);
    expect(rec.as).toBe("w");
    expect(rec.reviewedAt).toBe(NOW);
    expect(rec.lastOpenedAt).toBe(NOW);
  });
});

describe("the rules for keeping a game's record", () => {
  const existing = record({ as: "w" });

  it("keeps a new game as it is", () => {
    expect(upsert(null, existing, NOW)).toBe(existing);
  });

  it("notes a revisit without replacing the review", () => {
    const later = NOW + 5000;
    const rec = upsert(existing, record({ reviewedAt: later, lastOpenedAt: later }), later);
    expect(rec.reviewedAt).toBe(existing.reviewedAt);
    expect(rec.lastOpenedAt).toBe(later);
    expect(rec.depth).toBe(existing.depth);
    expect(rec.data).toBe(existing.data);
  });

  it("follows the orientation the game is now viewed from", () => {
    const later = NOW + 5000;
    expect(upsert(existing, record({ as: "b", reviewedAt: later, lastOpenedAt: later }), later).as).toBe("b");
  });

  it("replaces the review when it was made at another depth", () => {
    const later = NOW + 5000;
    const rec = upsert(existing, record({ depth: 18, reviewedAt: later, lastOpenedAt: later }), later);
    expect(rec.depth).toBe(18);
    expect(rec.reviewedAt).toBe(later);
  });

  it("replaces an old record that had no packed review", () => {
    const later = NOW + 5000;
    const rec = upsert(record({ data: undefined }), record({ reviewedAt: later, lastOpenedAt: later }), later);
    expect(rec.data).toBe("packed");
    expect(rec.reviewedAt).toBe(later);
  });
});
