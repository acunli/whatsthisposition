import { describe, expect, it } from "vitest";
import { packReview } from "../review/share";
import { substanceKeyOf } from "./record";
import { exportFile, exportFileName, mergeImported, parseImport } from "./transfer";
import { HISTORY_VERSION } from "./types";
import type { HistoryRecord } from "./types";

const PGN = '[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n';
const NOW = 1_760_000_000_000;

const record = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
  v: 1,
  id: "0".repeat(32),
  pgn: PGN,
  depth: 14,
  data: undefined,
  reviewedAt: NOW,
  lastOpenedAt: NOW,
  summary: {
    white: "Ada",
    black: "Ben",
    result: "1-0",
    opening: null,
    plies: 6,
    accuracy: { w: 80, b: 70 },
    counts: { mistake: { w: 0, b: 2 } },
  },
  ...overrides,
});

/** A packed review of the game above: seven positions (six plies), only the first analysed. */
const packed = async () =>
  packReview(
    [{ depth: 14, eval: { kind: "cp", cp: 30 }, lines: [{ multipv: 1, depth: 14, eval: { kind: "cp", cp: 30 }, pv: ["e2e4"] }] }, null, null, null, null, null, null],
    14,
  );

describe("the export file's name", () => {
  it("carries the day", () => {
    expect(exportFileName(NOW)).toMatch(/^whatsthisposition-history-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe("exporting and importing", () => {
  it("round-trips a record", async () => {
    const rec = record({ data: await packed(), as: "w" });
    const back = await parseImport(exportFile([rec]), NOW + 1);
    expect(back).toMatchObject({ ok: true, kept: 1, rejected: 0 });
    if (!back.ok) return;
    const imported = back.records[0];
    // The id in the file is ignored; the one computed from the PGN stands.
    expect(imported.id).not.toBe(rec.id);
    expect(imported.id).toHaveLength(32);
    expect(imported.pgn).toBe(rec.pgn);
    expect(imported.key).toBe(await substanceKeyOf(rec.pgn));
    expect(imported.data).toBe(rec.data);
    expect(imported.depth).toBe(14);
    expect(imported.as).toBe("w");
    // The facts come from the PGN; the numbers are recomputed from the packed review.
    expect(imported.summary.white).toBe("Ada");
    expect(imported.summary.black).toBe("Ben");
    expect(imported.summary.result).toBe("1-0");
    expect(imported.summary.plies).toBe(6);
  });

  it("never trusts the file's summary", async () => {
    const rec = record({
      data: await packed(),
      summary: { ...record().summary, white: "Mallory", black: "Eve", result: "0-1", accuracy: { w: 99.9, b: 99.9 } },
    });
    const back = await parseImport(exportFile([rec]));
    if (!back.ok) throw new Error("should have imported");
    const summary = back.records[0].summary;
    expect(summary.white).toBe("Ada");
    expect(summary.black).toBe("Ben");
    expect(summary.result).toBe("1-0");
    expect(summary.accuracy.w).not.toBe(99.9);
    expect(summary.accuracy.b).not.toBe(99.9);
  });

  it("has no numbers for a record whose packed review is missing or doesn't fit", async () => {
    const tooShort = await packReview([null, null], 14);
    for (const data of [undefined, tooShort]) {
      const back = await parseImport(exportFile([record({ data })]));
      if (!back.ok) throw new Error("should have imported");
      expect(back.records[0].summary.accuracy).toEqual({ w: null, b: null });
      expect(back.records[0].summary.counts).toEqual({});
    }
  });

  it("keeps a record whose packed review doesn't fit, without the review", async () => {
    const rec = record({ data: "not a review" });
    const back = await parseImport(exportFile([rec]));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.kept).toBe(1);
      expect(back.records[0].data).toBeUndefined();
    }
  });

  it("keeps a record whose packed review is too short for the game", async () => {
    // Two positions, but the game has six plies (seven positions).
    const tooShort = await packReview([null, null], 14);
    const back = await parseImport(exportFile([record({ data: tooShort })]));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.records[0].data).toBeUndefined();
  });

  it("refuses a file that isn't this app's history", async () => {
    const refuse = async (text: string) => {
      const back = await parseImport(text);
      if (back.ok) throw new Error("should have refused");
      return back.reason;
    };
    expect(await refuse("not json at all")).toBe("unreadable");
    expect(await refuse(JSON.stringify({ app: "other", version: 1, games: [] }))).toBe("not-history");
    expect(await refuse(JSON.stringify({ app: "whatsthisposition-history", version: HISTORY_VERSION + 1, games: [] }))).toBe("newer-version");
    expect(await refuse(JSON.stringify({ app: "whatsthisposition-history", version: 1 }))).toBe("not-history");
  });

  it("refuses a file with too many games", async () => {
    const games = Array.from({ length: 2001 }, () => record());
    const back = await parseImport(JSON.stringify({ app: "whatsthisposition-history", version: 1, games }));
    if (back.ok) throw new Error("should have refused");
    expect(back.reason).toBe("too-large");
  });

  it("skips bad records and keeps the good ones", async () => {
    const back = await parseImport(
      JSON.stringify({
        app: "whatsthisposition-history",
        version: 1,
        games: [
          record(),
          "not an object",
          { ...record(), pgn: "not a pgn" },
          { ...record(), depth: 0 },
          { ...record(), depth: "14" },
          record({ pgn: PGN.replace("2. Nf3", "2. Kf3") }), // an illegal move
        ],
      }),
    );
    expect(back).toMatchObject({ ok: true, kept: 1, rejected: 5 });
  });
});

/** A PGN of a different game, so two records in one test are two games. */
const OTHER = (moves: string) => `[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n${moves} 1-0\n`;

describe("merging an import into the history", () => {
  it("adds the new games and never drops the old ones", async () => {
    const existing = [record({ id: "a", pgn: OTHER("1. e4 e5") }), record({ id: "b", pgn: OTHER("1. d4 d5") })];
    const imported = [record({ id: "b", pgn: OTHER("1. d4 d5") }), record({ id: "c", pgn: OTHER("1. c4 e5") })];
    const { merged, changed, added, skipped } = await mergeImported(existing, imported);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(changed.map((r) => r.id)).toEqual(["c"]);
    expect(added).toBe(1);
    expect(skipped).toBe(1);
  });

  it("keeps the higher depth", async () => {
    const { merged } = await mergeImported([record({ id: "a", depth: 18 })], [record({ id: "a", depth: 14 })]);
    expect(merged[0].depth).toBe(18);
    const other = await mergeImported([record({ id: "a", depth: 14 })], [record({ id: "a", depth: 18 })]);
    expect(other.merged[0].depth).toBe(18);
    expect(other.changed).toHaveLength(1);
  });

  it("at the same depth, prefers the one with a review, then the newer one", async () => {
    const { merged } = await mergeImported([record({ id: "a", data: "packed" })], [record({ id: "a", data: undefined, reviewedAt: NOW + 9 })]);
    expect(merged[0].data).toBe("packed");
    const newer = await mergeImported([record({ id: "a", reviewedAt: NOW })], [record({ id: "a", reviewedAt: NOW + 9 })]);
    expect(newer.merged[0].reviewedAt).toBe(NOW + 9);
  });

  it("does not re-stamp a record for the same packed review", async () => {
    const { merged, changed, skipped } = await mergeImported([record({ id: "a", data: "packed" })], [record({ id: "a", data: "packed", reviewedAt: NOW + 9 })]);
    expect(merged[0].reviewedAt).toBe(NOW);
    expect(changed).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("recognises the same game from another source by its substance key", async () => {
    // The same moves, written with different headers (and so a different id) by two sources.
    const apiPgn = '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.12"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n';
    const pagePgn = '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.13"]\n[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n';
    const local = record({ id: "local-id", pgn: apiPgn, key: await substanceKeyOf(apiPgn), depth: 12 });
    const incoming = record({ id: "other-id", pgn: pagePgn, key: await substanceKeyOf(pagePgn), depth: 16, reviewedAt: NOW + 9 });
    const { merged, changed, added } = await mergeImported([local], [incoming]);
    expect(merged).toHaveLength(1);
    // The row keeps the id it already had here, and the deeper review replaces it.
    expect(merged[0].id).toBe("local-id");
    expect(merged[0].depth).toBe(16);
    expect(changed).toHaveLength(1);
    expect(added).toBe(1);
  });

  it("recognises a record written before keys existed", async () => {
    // Only the PGN, no key: it is keyed from the PGN when the import is matched.
    const local = record({ id: "old-id" });
    const incoming = record({ id: "new-id", pgn: PGN.replace('[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]', '[White "Ada"]\n[Black "Ben"]\n[Result "1-0"]\n[Site "Elsewhere"]'), depth: 18 });
    const { merged } = await mergeImported([local], [incoming]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("old-id");
    expect(merged[0].depth).toBe(18);
  });
});
