/**
 * Fetches a player's recent games from Lichess and Chess.com, or one Lichess game
 * by link. Both sites have free public APIs and no key is needed:
 *   Lichess    lichess.org/api/games/user/{name} (ndjson) · lichess.org/game/export/{id}
 *   Chess.com  api.chess.com/pub/player/{name}/games/archives → monthly archive
 * `fetch` is injected so the parsing can be tested without the network.
 */

export type Site = "lichess" | "chesscom";

export interface GameSummary {
  id: string;
  site: Site;
  url: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  /** "1-0", "0-1", "1/2-1/2" or "*". */
  result: string;
  /** Epoch milliseconds. */
  playedAt?: number;
  speed?: string;
  opening?: string;
  pgn: string;
}

export class ImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "WhatsThisPosition game review (+https://whatsthisposition.com)";

/** Usernames on both sites: letters, digits, _ and -, 2–30 characters. */
export function validUsername(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(name);
}

/** A Lichess game id from a game link (lichess.org/abcd1234, …/abcd1234/black, …/abcd1234wxyz). */
export function lichessGameId(text: string): string | null {
  const m = text.trim().match(/^(?:https?:\/\/)?(?:www\.)?lichess\.org\/(?:game\/export\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/);
  return m ? m[1] : null;
}

/** True for a Chess.com game link (these can't be fetched by id through the public API). */
export function isChessComGameLink(text: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:analysis\/)?game\/(?:live|daily)\/\d+/.test(text.trim());
}

interface LichessPlayer {
  user?: { name?: string };
  aiLevel?: number;
  rating?: number;
}

interface LichessGame {
  id: string;
  variant?: string;
  speed?: string;
  createdAt?: number;
  lastMoveAt?: number;
  status?: string;
  winner?: "white" | "black";
  players?: { white?: LichessPlayer; black?: LichessPlayer };
  opening?: { name?: string };
  pgn?: string;
}

const lichessName = (p?: LichessPlayer) => p?.user?.name ?? (p?.aiLevel ? `Stockfish level ${p.aiLevel}` : "Anonymous");

export function fromLichess(g: LichessGame): GameSummary | null {
  if (!g.pgn || (g.variant && g.variant !== "standard" && g.variant !== "fromPosition")) return null;
  const ongoing = g.status === "started" || g.status === "created";
  return {
    id: g.id,
    site: "lichess",
    url: `https://lichess.org/${g.id}`,
    white: lichessName(g.players?.white),
    black: lichessName(g.players?.black),
    whiteElo: g.players?.white?.rating,
    blackElo: g.players?.black?.rating,
    result: ongoing ? "*" : g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "1/2-1/2",
    playedAt: g.lastMoveAt ?? g.createdAt,
    speed: g.speed,
    opening: g.opening?.name,
    pgn: g.pgn,
  };
}

interface ChessComPlayer {
  username?: string;
  rating?: number;
  result?: string;
}

interface ChessComGame {
  url?: string;
  uuid?: string;
  pgn?: string;
  end_time?: number;
  time_class?: string;
  rules?: string;
  /** Link to the opening page, e.g. https://www.chess.com/openings/Pirc-Defense-Czech-Defense-4.f4 */
  eco?: string;
  white?: ChessComPlayer;
  black?: ChessComPlayer;
}

const DRAWN = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

export function fromChessCom(g: ChessComGame): GameSummary | null {
  if (!g.pgn || (g.rules && g.rules !== "chess")) return null;
  const w = g.white?.result;
  const b = g.black?.result;
  const result = w === "win" ? "1-0" : b === "win" ? "0-1" : w && DRAWN.has(w) ? "1/2-1/2" : (g.pgn.match(/\[Result "([^"]+)"\]/)?.[1] ?? "*");
  const eco = (g.eco ?? g.pgn.match(/\[ECOUrl "([^"]+)"\]/)?.[1])?.match(/\/openings\/([^/?#]+)/)?.[1];
  return {
    id: g.uuid ?? g.url ?? String(g.end_time),
    site: "chesscom",
    url: g.url ?? "https://www.chess.com",
    white: g.white?.username ?? "White",
    black: g.black?.username ?? "Black",
    whiteElo: g.white?.rating,
    blackElo: g.black?.rating,
    result,
    playedAt: g.end_time ? g.end_time * 1000 : undefined,
    speed: g.time_class,
    // "Alapin-Sicilian-Defense-Barmen-Defense...10.O-O-Bxc3" → "Alapin Sicilian Defense Barmen Defense"
    opening: eco ? decodeURIComponent(eco).replace(/(?:\.{3}|-)\d+\..*$/, "").replace(/-/g, " ") : undefined,
    pgn: g.pgn,
  };
}

async function get(fetchImpl: Fetch, url: string, accept: string, token?: string): Promise<Response> {
  let res: Response;
  const headers: Record<string, string> = { Accept: accept, "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    res = await fetchImpl(url, { headers, cache: "no-store" });
  } catch {
    throw new ImportError("Couldn't reach the chess site. Check your connection and try again.", 502);
  }
  if (res.status === 404) throw new ImportError("No such player or game was found.", 404);
  if (res.status === 429) throw new ImportError("The chess site is rate-limiting requests. Wait a minute and try again.", 429);
  if (!res.ok) throw new ImportError(`The chess site answered with an error (${res.status}).`, 502);
  return res;
}

/**
 * Lichess lists a player's games only to signed-in API clients, so this needs a
 * personal API token (free, no scopes) on the server. Without one, or if the
 * listing is refused, the error says how to bring a game in another way.
 */
export async function lichessUserGames(user: string, fetchImpl: Fetch = fetch, token?: string, max = 20): Promise<GameSummary[]> {
  if (!validUsername(user)) throw new ImportError("That isn't a valid Lichess username.");
  const noList = "Lichess only lists a player's games to signed-in apps. Paste a Lichess game link (lichess.org/…) or the game's PGN instead.";
  if (!token) throw new ImportError(noList, 403);
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&opening=true&clocks=true&moves=true`;
  let res: Response;
  try {
    res = await get(fetchImpl, url, "application/x-ndjson", token);
  } catch (e) {
    if (e instanceof ImportError && e.status === 404) {
      const exists = await fetchImpl(`https://lichess.org/api/user/${encodeURIComponent(user)}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }).then(
        (r) => r.ok,
        () => false,
      );
      throw exists ? new ImportError(noList, 403) : new ImportError(`No Lichess player called ${user}.`, 404);
    }
    throw e;
  }
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return fromLichess(JSON.parse(l) as LichessGame);
      } catch {
        return null;
      }
    })
    .filter((g): g is GameSummary => !!g);
}

export async function lichessGame(id: string, fetchImpl: Fetch = fetch): Promise<GameSummary> {
  if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new ImportError("That isn't a Lichess game link.");
  const url = `https://lichess.org/game/export/${id}?pgnInJson=true&opening=true&clocks=true`;
  const g = fromLichess((await (await get(fetchImpl, url, "application/json")).json()) as LichessGame);
  if (!g) throw new ImportError("That game isn't standard chess, so it can't be reviewed.");
  return g;
}

export async function chessComUserGames(user: string, fetchImpl: Fetch = fetch, max = 20): Promise<GameSummary[]> {
  if (!validUsername(user)) throw new ImportError("That isn't a valid Chess.com username.");
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`;
  const { archives = [] } = (await (await get(fetchImpl, base, "application/json")).json()) as { archives?: string[] };
  const out: GameSummary[] = [];
  // Newest month first; older months only if the latest one is thin.
  for (const month of archives.slice(-3).reverse()) {
    if (!/^https:\/\/api\.chess\.com\/pub\/player\//.test(month)) continue;
    const { games = [] } = (await (await get(fetchImpl, month, "application/json")).json()) as { games?: ChessComGame[] };
    for (const g of [...games].reverse()) {
      const s = fromChessCom(g);
      if (s) out.push(s);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
