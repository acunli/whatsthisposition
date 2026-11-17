import { describe, expect, it } from "vitest";
import type { LichessGame } from "./importers";
import { gameFromLichess, lichessMessage, lichessState } from "./lichessGame";
import { parseFirstGame } from "./pgn";

// The shape of Lichess's /game/export/{id} JSON (pgnInJson, clocks), cut down from a real bullet game.
const PGN = `[Event "rated bullet game"]
[Site "https://lichess.org/game/raEygTd9"]
[Date "2026.11.17"]
[White "Emporio_Armani"]
[Black "HowellHub"]
[Result "0-1"]
[WhiteElo "2854"]
[BlackElo "2917"]
[Variant "Standard"]
[TimeControl "60+0"]
[Termination "Normal"]

1. f3 { [%clk 0:01:00] } 1... e5 { [%clk 0:01:00] } 2. g4 { [%clk 0:00:59] } 2... Qh4# { [%clk 0:00:59] } 0-1`;

const game = (over: Partial<LichessGame> = {}): LichessGame => ({
  id: "raEygTd9",
  variant: "standard",
  speed: "bullet",
  createdAt: 1794892652632,
  lastMoveAt: 1794892713245,
  status: "mate",
  winner: "black",
  players: { white: { user: { name: "Emporio_Armani" }, rating: 2854 }, black: { user: { name: "HowellHub" }, rating: 2917 } },
  moves: "f3 e5 g4 Qh4#",
  pgn: PGN,
  ...over,
});

describe("Lichess games for the extension's card", () => {
  it("turns a finished game into the card's game", () => {
    const g = gameFromLichess(game(), "b")!;
    expect(g).toMatchObject({
      id: "raEygTd9",
      white: "Emporio_Armani",
      black: "HowellHub",
      result: "0-1",
      message: "HowellHub won by checkmate",
      bottom: "b",
      url: "https://lichess.org/raEygTd9",
      endedAt: 1794892713245,
      plies: 4,
    });
    // The PGN is Lichess's own, clocks and ratings included, and reads as a game.
    const parsed = parseFirstGame(g.pgn);
    expect(parsed.moves).toHaveLength(4);
    expect(parsed.whiteElo).toBe("2854");
  });

  it("says how a game ended", () => {
    expect(lichessMessage("resign", "white", "A", "B")).toBe("A won by resignation");
    expect(lichessMessage("outoftime", "black", "A", "B")).toBe("B won on time");
    expect(lichessMessage("timeout", "white", "A", "B")).toBe("A won by abandonment");
    expect(lichessMessage("outoftime", undefined, "A", "B")).toBe("Draw on time");
    expect(lichessMessage("stalemate", undefined, "A", "B")).toBe("Draw by stalemate");
    expect(lichessMessage("draw", undefined, "A", "B")).toBe("Draw");
    expect(lichessMessage("cheat", "black", "A", "B")).toBe("B won");
  });

  it("has nothing for a game still on, aborted, a variant or without moves", () => {
    expect(lichessState(game({ status: "started" }))).toBe("playing");
    expect(gameFromLichess(game({ status: "started", winner: undefined }), "w")).toBeNull();
    expect(lichessState(game({ status: "aborted" }))).toBe("aborted");
    expect(gameFromLichess(game({ status: "aborted" }), "w")).toBeNull();
    expect(lichessState(game({ status: "noStart" }))).toBe("aborted");
    expect(lichessState(game({ variant: "crazyhouse" }))).toBe("variant");
    expect(gameFromLichess(game({ variant: "crazyhouse" }), "w")).toBeNull();
    expect(gameFromLichess(game({ moves: "" }), "w")).toBeNull();
    // A game from a set position is standard chess.
    expect(gameFromLichess(game({ variant: "fromPosition" }), "w")?.plies).toBe(4);
  });
});
