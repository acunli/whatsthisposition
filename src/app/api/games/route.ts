/**
 * GET /api/games?site=lichess|chesscom&user=NAME  → a player's recent games
 * GET /api/games?link=https://lichess.org/abcd1234 → one Lichess game
 *
 * Proxies the sites' free public APIs (so we can send a proper User-Agent and
 * avoid CORS surprises). Nothing is stored.
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { ImportError, chessComUserGames, isChessComGameLink, lichessGame, lichessGameId, lichessUserGames, type GameSummary } from "@/lib/review/importers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Reply = { ok: true; games: GameSummary[] } | { ok: false; message: string };

/** Chess.com and Lichess usernames: letters, digits, "_" and "-". */
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

export async function GET(req: Request) {
  const wait = rateLimit(`games:${clientIp(req)}`, 20, 60_000);
  if (wait) return NextResponse.json<Reply>({ ok: false, message: `Too many requests. Try again in ${wait} s.` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const q = new URL(req.url).searchParams;
  const link = q.get("link")?.trim().slice(0, 200);
  const user = q.get("user")?.trim() ?? "";
  const site = q.get("site");
  try {
    if (!link && !USERNAME.test(user)) throw new ImportError("That doesn't look like a username: use letters, digits, _ or -.");
    if (link) {
      const id = lichessGameId(link);
      if (id) return NextResponse.json<Reply>({ ok: true, games: [await lichessGame(id)] });
      if (isChessComGameLink(link))
        throw new ImportError("Chess.com doesn't share single games by link. Enter your Chess.com username instead, or paste the game's PGN (Share → PGN).");
      throw new ImportError("Paste a Lichess game link, or use a username.");
    }
    if (site === "lichess") return NextResponse.json<Reply>({ ok: true, games: await lichessUserGames(user, fetch, process.env.LICHESS_TOKEN || undefined) });
    if (site === "chesscom") return NextResponse.json<Reply>({ ok: true, games: await chessComUserGames(user) });
    throw new ImportError("Choose Lichess or Chess.com.");
  } catch (e) {
    const err = e instanceof ImportError ? e : new ImportError("Something went wrong while fetching games.", 500);
    return NextResponse.json<Reply>({ ok: false, message: err.message }, { status: err.status });
  }
}
