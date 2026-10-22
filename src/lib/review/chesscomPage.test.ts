import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { decodeTcn } from "./chesscomGame";
import { LIVE_AFTER_MS, MoveListWatch, cleanSan, figurineLetter, gameFromPage, readResult, type MoveListSighting } from "./chesscomPage";
import { parseFirstGame } from "./pgn";

// One of Ay7u's games, ending in mate (the same as in chesscomGame.test.ts).
const MATE_TCN = "lBZJmCJCbs5QnvCvdvQBvt6LtHBHsH!TcMYQHs0SftLtkt7tgv86en9InwtUvKUMwvMKoE7tvoTCsmCMpFKm";
const sans = () => {
  const c = new Chess();
  for (const m of decodeTcn(MATE_TCN)) c.move(m);
  return c.history();
};

describe("Chess.com games read off the page", () => {
  it("reads results, figurines and moves as Chess.com shows them", () => {
    expect(readResult("0-1 ")).toBe("0-1");
    expect(readResult("½-½")).toBe("1/2-1/2");
    expect(readResult("1/2-1/2")).toBe("1/2-1/2");
    expect(readResult("Game Aborted")).toBeNull();
    expect(readResult(undefined)).toBeNull();
    expect(figurineLetter("N")).toBe("N");
    expect(figurineLetter(null, "icon-font-chess queen-black")).toBe("Q");
    expect(figurineLetter(null, "node-highlight-content")).toBe("");
    expect(cleanSan("Nf3 ")).toBe("Nf3");
    expect(cleanSan("♘xe5+")).toBe("Nxe5+");
    expect(cleanSan("0-0-0")).toBe("O-O-O");
    expect(cleanSan(" e8=Q# ")).toBe("e8=Q#");
  });

  it("turns the page's moves into a game the review can read", () => {
    const moves = sans();
    const g = gameFromPage(
      {
        sans: moves.map((s) => `${s} `),
        result: "0-1",
        white: { name: "AAchun", rating: 1484 },
        black: { name: "Ay7u", rating: 1507 },
        bottom: "b",
        how: " by checkmate ",
        ref: { id: 184654081790, kind: "live" },
        url: "https://www.chess.com/play/online",
      },
      Date.UTC(2026, 9, 22),
    )!;
    expect(g).toMatchObject({ id: 184654081790, white: "AAchun", black: "Ay7u", result: "0-1", message: "Ay7u won by checkmate", bottom: "b", url: "https://www.chess.com/game/live/184654081790", plies: 42 });
    const parsed = parseFirstGame(g.pgn);
    expect(parsed.moves).toHaveLength(42);
    expect(parsed.whiteElo).toBe("1484");
    expect(parsed.result).toBe("0-1");
    expect(g.pgn).toMatch(/\[Date "2026\.10\.22"\]/);
  });

  it("gives no game when the moves aren't legal or there are none", () => {
    const base = { result: "1-0" as const, white: { name: null, rating: null }, black: { name: null, rating: null }, bottom: "w" as const, url: "https://www.chess.com/play/computer" };
    expect(gameFromPage({ ...base, sans: ["e4", "e5", "Ke3"] })).toBeNull();
    expect(gameFromPage({ ...base, sans: [] })).toBeNull();
    const g = gameFromPage({ ...base, sans: ["e4", "e5"] })!;
    expect(g).toMatchObject({ white: "White", black: "Black", message: "White won", id: 0, url: "https://www.chess.com/play/computer" });
  });
});

describe("Watching the move list for the end of a game", () => {
  const run = (steps: [number, MoveListSighting | null][]) => {
    const w = new MoveListWatch();
    return { w, events: steps.map(([t, s]) => w.see(s, t)) };
  };

  it("sees a game played move by move end", () => {
    const { w, events } = run([
      [0, { plies: 0, result: null }],
      [500, { plies: 1, result: null }],
      [1000, { plies: 2, result: null }],
      [1500, null], // the move list hidden for a moment: nothing changes
      [2000, { plies: 3, result: null }],
      [2500, { plies: 4, result: "1-0" }],
    ]);
    expect(events).toEqual([null, null, null, null, null, "ended"]);
    expect(w).toMatchObject({ live: true, ended: true, result: "1-0" });
  });

  it("doesn't call a game opened already finished an ending", () => {
    expect(run([[0, { plies: 68, result: "0-1" }], [500, { plies: 68, result: "0-1" }]]).events).toEqual([null, null]);
    // The moves and the result arrive together after an empty board.
    const loaded = run([[0, { plies: 0, result: null }], [300, { plies: 68, result: "0-1" }]]);
    expect(loaded.events).toEqual([null, null]);
    expect(loaded.w.live).toBe(false);
    // Even after an empty board has waited long enough to count as a game in progress.
    const waited = run([[0, { plies: 0, result: null }], [LIVE_AFTER_MS + 1, { plies: 0, result: null }], [LIVE_AFTER_MS + 500, { plies: 40, result: "1-0" }]]);
    expect(waited.events.at(-1)).toBeNull();
    // Moves arriving in one jump don't count as moves played.
    expect(run([[0, { plies: 0, result: null }], [200, { plies: 40, result: null }], [400, { plies: 40, result: "1-0" }]]).events.at(-1)).toBeNull();
  });

  it("sees the end even when the last moves came in a burst", () => {
    const { events } = run([
      [0, { plies: 18, result: null }],
      [500, { plies: 20, result: null }],
      [1000, { plies: 25, result: "1-0" }],
    ]);
    expect(events.at(-1)).toBe("ended");
    // A shorter game replacing the one being played was opened, not played.
    expect(run([[0, { plies: 28, result: null }], [500, { plies: 30, result: null }], [1000, { plies: 20, result: "1-0" }]]).events.at(-1)).toBeNull();
  });

  it("sees the end of a game that was open without moves for a while (opened mid-game)", () => {
    const { events } = run([
      [0, { plies: 20, result: null }],
      [LIVE_AFTER_MS, { plies: 20, result: null }],
      [LIVE_AFTER_MS + 500, { plies: 20, result: "0-1" }],
    ]);
    expect(events.at(-1)).toBe("ended");
  });

  it("starts over when another game starts in the same list", () => {
    const { w, events } = run([
      [0, { plies: 0, result: null }],
      [500, { plies: 1, result: null }],
      [1000, { plies: 2, result: "0-1" }],
      [1500, { plies: 0, result: null }],
      [2000, { plies: 1, result: null }],
      [2500, { plies: 2, result: "1/2-1/2" }],
    ]);
    expect(events).toEqual([null, null, "ended", "new", null, "ended"]);
    expect(w.result).toBe("1/2-1/2");
  });
});
