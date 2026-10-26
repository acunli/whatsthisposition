import { describe, expect, it } from "vitest";
import { chessComGame, chessComUserGames, fromChessCom, fromLichess, lichessChapter, lichessChapterRef, lichessGame, lichessGameId, lichessUserGames, profileLink, validUsername } from "./importers";
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
    expect(lichessGameId("https://lichess.org/embed/game/7mLyypTV?theme=auto")).toBe("7mLyypTV");
    // Lichess pages with eight-letter addresses aren't games.
    expect(lichessGameId("https://lichess.org/analysis/standard/rnbqkbnr")).toBeNull();
    expect(lichessGameId("https://lichess.org/training/abc12")).toBeNull();
  });

  it("recognises study and broadcast games, and players' pages", () => {
    expect(lichessChapterRef("https://lichess.org/study/abcdEFGH/ijklMNOP#12")).toEqual({ study: "abcdEFGH", chapter: "ijklMNOP" });
    expect(lichessChapterRef("https://lichess.org/broadcast/english-championships/round-6/UzfvBEiM/3DFLz5cf")).toEqual({ study: "UzfvBEiM", chapter: "3DFLz5cf" });
    expect(lichessChapterRef("https://lichess.org/broadcast/english-championships/round-6/UzfvBEiM")).toBeNull();
    expect(lichessChapterRef("https://lichess.org/7mLyypTV")).toBeNull();
    expect(profileLink("https://lichess.org/@/DrNykterstein/all")).toEqual({ site: "lichess", user: "DrNykterstein" });
    expect(profileLink("https://www.chess.com/member/Hikaru")).toEqual({ site: "chesscom", user: "Hikaru" });
    expect(profileLink("chess.com/games/archive/ay7u?gameOwner=other")).toEqual({ site: "chesscom", user: "ay7u" });
    expect(profileLink("https://www.chess.com/stats/live/rapid/ay7u")).toEqual({ site: "chesscom", user: "ay7u" });
    expect(profileLink("https://www.chess.com/game/live/184654081790")).toBeNull();
  });

  it("opens a game of a Lichess study or broadcast", async () => {
    const chapter = `[Event "English Rapid"]\n[White "Ghasi, Ameet K"]\n[Black "Gormally, Daniel W"]\n[Result "1-0"]\n[WhiteElo "2505"]\n[BlackElo "2454"]\n[Variant "Standard"]\n[GameURL "https://lichess.org/broadcast/e/r/UzfvBEiM/3DFLz5cf"]\n\n1. Nf3 { [%clk 0:15:18] } 1... Nf6 2. g3 g6 1-0\n`;
    let asked = "";
    const g = await lichessChapter({ study: "UzfvBEiM", chapter: "3DFLz5cf" }, async (url) => {
      asked = url;
      return new Response(chapter, { status: 200 });
    });
    expect(asked).toMatch(/^https:\/\/lichess\.org\/api\/study\/UzfvBEiM\/3DFLz5cf\.pgn/);
    expect(g).toMatchObject({ site: "lichess", white: "Ghasi, Ameet K", black: "Gormally, Daniel W", whiteElo: 2505, blackElo: 2454, result: "1-0", url: "https://lichess.org/broadcast/e/r/UzfvBEiM/3DFLz5cf" });
    expect(parseGame(g.pgn).moves).toHaveLength(4);
    await expect(lichessChapter({ study: "UzfvBEiM", chapter: "3DFLz5cf" }, async () => new Response(chapter.replace("Standard", "Chess960")))).rejects.toThrow(/isn't standard chess/);
    await expect(lichessChapter({ study: "UzfvBEiM", chapter: "3DFLz5cf" }, async () => new Response("", { status: 404 }))).rejects.toThrow(/No such player or game/);
  });

  it("opens a Chess.com game from its link, live or daily", async () => {
    // Ay7u's mate against AAchun, as Chess.com's game page JSON gives it.
    const game = {
      id: 184654081790,
      moveList: "lBZJmCJCbs5QnvCvdvQBvt6LtHBHsH!TcMYQHs0SftLtkt7tgv86en9InwtUvKUMwvMKoE7tvoTCsmCMpFKm",
      isFinished: true,
      typeName: "Standard Chess",
      endTime: 1790861375,
      pgnHeaders: { Event: "Live Chess", White: "AAchun", Black: "Ay7u", Result: "0-1", WhiteElo: 1484, BlackElo: 1507 },
    };
    const calls: string[] = [];
    const site = (live: unknown, daily: unknown = null) => async (url: string) => {
      calls.push(url);
      const body = url.includes("/callback/live/") ? live : daily;
      return body ? respond(body) : respond({}, 404);
    };

    const g = await chessComGame("https://www.chess.com/game/live/184654081790?move=12", site({ game }));
    expect(calls).toEqual(["https://www.chess.com/callback/live/game/184654081790"]);
    expect(g).toMatchObject({ site: "chesscom", white: "AAchun", black: "Ay7u", whiteElo: 1484, blackElo: 1507, result: "0-1", url: "https://www.chess.com/game/live/184654081790" });
    expect(parseGame(g.pgn).moves).toHaveLength(42);

    // A link that doesn't say live or daily is tried as both; one that does isn't.
    calls.length = 0;
    expect((await chessComGame("chess.com/game/9876", site(null, { game: { ...game, id: 9876 } }))).url).toBe("https://www.chess.com/game/daily/9876");
    expect(calls).toEqual(["https://www.chess.com/callback/live/game/9876", "https://www.chess.com/callback/daily/game/9876"]);
    calls.length = 0;
    await expect(chessComGame("https://www.chess.com/analysis/game/daily/9876?tab=review", site(null))).rejects.toThrow(/No Chess.com game/);
    expect(calls).toEqual(["https://www.chess.com/callback/daily/game/9876"]);

    await expect(chessComGame("https://www.chess.com/game/live/1", site({ game: { ...game, isFinished: false } }))).rejects.toThrow(/hasn't finished/);
    await expect(chessComGame("https://www.chess.com/game/live/1", site({ game: { ...game, typeName: "Chess960" } }))).rejects.toThrow(/isn't standard chess/);
    await expect(chessComGame("https://www.chess.com/game/live/1", async () => new Response("<!DOCTYPE html>", { status: 403 }))).rejects.toThrow(/didn't hand over/);
    await expect(chessComGame("https://www.chess.com/member/ay7u", site({ game }))).rejects.toThrow(/isn't a Chess.com game link/);
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
