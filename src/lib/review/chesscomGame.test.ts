import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { chessComGameRef, decodeTcn, gameFromCallback, type ChessComCallback } from "./chesscomGame";
import { parseFirstGame } from "./pgn";
import { readReviewHash, reviewLink } from "./share";

// Two of Ay7u's games: one ending in mate, one with a promotion (…d1=Q).
const MATE = { tcn: "lBZJmCJCbs5QnvCvdvQBvt6LtHBHsH!TcMYQHs0SftLtkt7tgv86en9InwtUvKUMwvMKoE7tvoTCsmCMpFKm", fen: "2k4r/pp3ppp/2p1p3/2b3n1/6PP/3r4/PP2q1K1/R6R w - - 0 22" };
const PROMO = {
  tcn: "nD!Tgv5QlBZJmu6EkA0SiqTCbs1TftCsjsSKAJ7JDKTKegKCsAJLvFLNdrQGrHNHAHCtpxEmfeGrabtlclrlbjmHjl9qebHOln86FL?9L29ngn79ng912S10BJOAuCAtCKYQbrtArqAJSD0KDJQJqW6YgnJBWqYQoEXHxFHzqtQItdIAdcArnvrjcABtAzjkzAkdABtlvDK8EMdeFNl~BdedMU89DM98U28!MVdmV3mu",
  fen: "6r1/6PK/8/7P/8/4k3/8/8 w - - 1 60",
};

const play = (tcn: string) => {
  const c = new Chess();
  for (const m of decodeTcn(tcn)) c.move(m);
  return c;
};

describe("Chess.com games for the extension", () => {
  it("decodes TCN move lists, promotions included", () => {
    expect(play(MATE.tcn).fen()).toBe(MATE.fen);
    const c = play(PROMO.tcn);
    expect(c.fen()).toBe(PROMO.fen);
    expect(c.history({ verbose: true }).filter((m) => m.promotion).map((m) => m.san)).toEqual(["d1=Q"]);
    expect(decodeTcn("mClB")).toEqual([{ from: "e2", to: "e4" }, { from: "d2", to: "d4" }]);
  });

  it("turns the game page's JSON into a PGN the review can read", () => {
    const cb: ChessComCallback = {
      game: {
        id: 184654081790,
        moveList: MATE.tcn,
        isFinished: true,
        resultMessage: "Ay7u won by checkmate",
        typeName: "Standard Chess",
        pgnHeaders: { White: "AAchun", Black: "Ay7u", Result: "0-1", WhiteElo: 1484, BlackElo: 1507, SetUp: "1", FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
      },
      players: { top: { username: "AAchun", color: "white" }, bottom: { username: "Ay7u", color: "black" } },
    };
    const g = gameFromCallback(cb, "live")!;
    expect(g).toMatchObject({ white: "AAchun", black: "Ay7u", result: "0-1", bottom: "b", url: "https://www.chess.com/game/live/184654081790" });
    expect(g.pgn).not.toMatch(/SetUp/);
    const parsed = parseFirstGame(g.pgn);
    expect(parsed.moves).toHaveLength(42);
    expect(parsed.moves[41].fenAfter.split(" ")[0]).toBe(MATE.fen.split(" ")[0]);
    expect(gameFromCallback({ ...cb, game: { ...cb.game, isFinished: false } }, "live")).toBeNull();
    expect(gameFromCallback({ ...cb, game: { ...cb.game, typeName: "Chess960" } }, "live")).toBeNull();
  });

  it("finds the game in any shape of Chess.com URL", () => {
    expect(chessComGameRef("https://www.chess.com/game/live/184654081790")).toEqual({ kind: "live", id: 184654081790 });
    expect(chessComGameRef("https://www.chess.com/game/daily/9876?move=3")).toEqual({ kind: "daily", id: 9876 });
    expect(chessComGameRef("https://www.chess.com/analysis/game/live/123?tab=review")).toEqual({ kind: "live", id: 123 });
    expect(chessComGameRef("https://www.chess.com/live/game/55")).toEqual({ kind: "live", id: 55 });
    expect(chessComGameRef("https://www.chess.com/game/77")).toEqual({ kind: "live", id: 77 });
    expect(chessComGameRef("https://www.chess.com/play/online")).toBeNull();
  });

  it("carries a game in a link's fragment, unicode included", () => {
    const pgn = '[White "Zoë"]\n\n1. e4 e5 *';
    const link = reviewLink("https://whatsthisposition.vercel.app/", pgn, "b");
    expect(link.startsWith("https://whatsthisposition.vercel.app/#review=")).toBe(true);
    expect(readReviewHash(new URL(link).hash)).toEqual({ pgn, as: "b" });
    expect(readReviewHash("#review=@@@")).toBeNull();
    expect(readReviewHash("")).toBeNull();
  });
});
