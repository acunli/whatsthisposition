import { describe, expect, it } from "vitest";
import { chessComUserGames, fromChessCom, fromLichess, isChessComGameLink, lichessGame, lichessGameId, lichessUserGames, validUsername } from "./importers";
import { parseGame } from "./pgn";

const PGN = `[Event "Live Chess"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[ECOUrl "https://www.chess.com/openings/Pirc-Defense-Czech-Defense-4.f4"]

1. e4 {[%clk 0:03:00]} 1... d6 {[%clk 0:02:59.6]} 2. d4 Nf6 3. Nc3 c6 1-0`;

const respond = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("game import", () => {
  it("validates usernames and recognises game links", () => {
    expect(validUsername("Hikaru")).toBe(true);
    expect(validUsername("a")).toBe(false);
    expect(validUsername("bad name")).toBe(false);
    expect(validUsername("../etc")).toBe(false);
    expect(lichessGameId("https://lichess.org/7mLyypTV")).toBe("7mLyypTV");
    expect(lichessGameId("lichess.org/7mLyypTVab12/black")).toBe("7mLyypTV");
    expect(lichessGameId("https://lichess.org/@/thibault")).toBeNull();
    expect(isChessComGameLink("https://www.chess.com/game/live/184775676072")).toBe(true);
  });

  it("reads Chess.com archive games (newest first) into reviewable PGN", async () => {
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/archives")) return respond({ archives: ["https://api.chess.com/pub/player/alice/games/2026/09", "https://api.chess.com/pub/player/alice/games/2026/10"] });
      if (url.endsWith("/2026/10"))
        return respond({
          games: [
            { url: "https://www.chess.com/game/live/1", uuid: "u1", pgn: PGN, end_time: 1, rules: "chess", time_class: "blitz", white: { username: "alice", rating: 1500, result: "win" }, black: { username: "bob", rating: 1490, result: "resigned" } },
            { url: "https://www.chess.com/game/live/2", uuid: "u2", pgn: PGN, end_time: 2, rules: "chess960", white: { username: "alice" }, black: { username: "bob" } },
            { url: "https://www.chess.com/game/live/3", uuid: "u3", pgn: PGN, end_time: 3, rules: "chess", eco: "https://www.chess.com/openings/Sicilian-Defense", white: { username: "bob", result: "agreed" }, black: { username: "alice", result: "agreed" } },
          ],
        });
      return respond({ games: [] });
    };
    const games = await chessComUserGames("Alice", fake);
    expect(calls[0]).toBe("https://api.chess.com/pub/player/alice/games/archives");
    expect(games.map((g) => g.id)).toEqual(["u3", "u1"]); // newest first, variants dropped
    expect(games[0].result).toBe("1/2-1/2");
    expect(games[0].opening).toBe("Sicilian Defense");
    expect(games[1]).toMatchObject({ white: "alice", whiteElo: 1500, result: "1-0", opening: "Pirc Defense Czech Defense", speed: "blitz" });
    expect(parseGame(games[1].pgn).moves).toHaveLength(6);
  });

  it("reads Lichess games, with or without a token", async () => {
    const g = { id: "abcdEFGH", variant: "standard", speed: "rapid", status: "mate", winner: "black", players: { white: { user: { name: "ann" }, rating: 1800 }, black: { aiLevel: 3 } }, opening: { name: "Pirc Defense" }, pgn: PGN };
    expect(fromLichess(g as never)).toMatchObject({ white: "ann", black: "Stockfish level 3", result: "0-1", url: "https://lichess.org/abcdEFGH" });
    expect(fromLichess({ ...g, variant: "atomic" } as never)).toBeNull();
    expect(fromChessCom({ pgn: PGN, rules: "chess" })?.result).toBe("1-0");
    expect(fromChessCom({ pgn: PGN, eco: "https://www.chess.com/openings/Alapin-Sicilian-Defense-Barmen-Defense...10.O-O-Bxc3" })?.opening).toBe("Alapin Sicilian Defense Barmen Defense");

    const one = await lichessGame("abcdEFGH", async () => respond(g));
    expect(one.opening).toBe("Pirc Defense");

    // No token: Lichess still lists games as JSON lines, and the request asks for that form.
    let asked: RequestInit | undefined;
    const anon = await lichessUserGames("ann", async (_url, init) => {
      asked = init;
      return respond(`${JSON.stringify(g)}\n${JSON.stringify({ ...g, id: "zzzzzzzz" })}\n`);
    });
    expect(anon.map((x) => x.id)).toEqual(["abcdEFGH", "zzzzzzzz"]);
    expect((asked?.headers as Record<string, string>).Accept).toBe("application/x-ndjson");
    expect((asked?.headers as Record<string, string>).Authorization).toBeUndefined();
    const listed = await lichessUserGames("ann", async () => respond(`${JSON.stringify(g)}\n`), "token");
    expect(listed.map((x) => x.id)).toEqual(["abcdEFGH"]);
    expect(await lichessUserGames("ann", async () => respond(""))).toEqual([]);
    const missing = lichessUserGames("nobody", async () => respond({ error: "Not found" }, 404), "token");
    await expect(missing).rejects.toThrow(/No Lichess player/);
  });
});
