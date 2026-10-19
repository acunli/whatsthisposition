/**
 * Which games the daily job reviews, by general rules (no game or player is named here):
 *   - Lichess broadcasts of top over-the-board events (Lichess's tier 4 and 5): finished games
 *     of the last four days between players rated 2400+, at least 20 moves, two per event;
 *   - Chess.com's own leaderboards (the top five in blitz and in rapid): their rated blitz and
 *     rapid games of the last three days against players rated 2600+, at least 25 moves, one
 *     per player.
 * Stronger pairings rank first, and a decisive game counts for 50 rating points more.
 * Both sources are public APIs without a key; the moves of a game are facts, and every page
 * links back to where they come from.
 */
import { parseGame, splitGames, type ParsedGame } from "../review/pgn";
import type { GameSource } from "./games";

export interface Candidate {
  pgn: string;
  source: GameSource;
  /** YYYY-MM-DD */
  played?: string;
  rank: number;
}

export type Fetcher = (url: string) => Promise<Response>;

const DAY = 86_400_000;
const UA = { "User-Agent": "whatsthisposition (https://www.whatsthisposition.com)", Accept: "application/json" };
export const httpFetch: Fetcher = (url) => fetch(url, { headers: UA });

const json = async <T>(fetcher: Fetcher, url: string): Promise<T | null> => {
  try {
    const r = await fetcher(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

const text = async (fetcher: Fetcher, url: string): Promise<string | null> => {
  try {
    const r = await fetcher(url);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
};

const DECISIVE = new Set(["1-0", "0-1"]);
const FINISHED = new Set(["1-0", "0-1", "1/2-1/2"]);
const rankOf = (a: number, b: number, result: string) => Math.min(a, b) + (DECISIVE.has(result) ? 50 : 0);
const day = (pgnDate: string | undefined) => (pgnDate && /^\d{4}\.\d{2}\.\d{2}$/.test(pgnDate) ? pgnDate.replace(/\./g, "-") : undefined);

const tryParse = (pgn: string): ParsedGame | null => {
  try {
    return parseGame(pgn);
  } catch {
    return null;
  }
};

interface BroadcastTop {
  active?: { tour: BroadcastTour }[];
  past?: { currentPageResults?: { tour: BroadcastTour }[] };
}
interface BroadcastTour {
  id: string;
  name: string;
  tier?: number;
  info?: { fideTC?: string };
}
interface BroadcastRounds {
  rounds?: { id: string; name: string; startsAt?: number; finished?: boolean }[];
}

/** Finished games from top broadcasts whose round started in the last four days, leaving out `published` ones. */
export async function broadcastCandidates(fetcher: Fetcher, now = Date.now(), published = new Set<string>()): Promise<Candidate[]> {
  const top = await json<BroadcastTop>(fetcher, "https://lichess.org/api/broadcast/top?page=1");
  const tours = [...(top?.active ?? []), ...(top?.past?.currentPageResults ?? [])].map((t) => t.tour).filter((t) => (t?.tier ?? 0) >= 4);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const tour of tours.slice(0, 16)) {
    if (seen.has(tour.id)) continue;
    seen.add(tour.id);
    const detail = await json<BroadcastRounds>(fetcher, `https://lichess.org/api/broadcast/${tour.id}`);
    const rounds = (detail?.rounds ?? []).filter((r) => r.startsAt && r.startsAt <= now && r.startsAt >= now - 4 * DAY);
    const fromTour: Candidate[] = [];
    for (const round of rounds) {
      const pgn = await text(fetcher, `https://lichess.org/api/broadcast/round/${round.id}.pgn`);
      for (const one of splitGames(pgn ?? "")) {
        const g = tryParse(one);
        if (!g || !FINISHED.has(g.result) || g.moves.length < 40 || g.headers.SetUp === "1" || (g.headers.Variant && g.headers.Variant !== "Standard")) continue;
        const we = Number(g.whiteElo);
        const be = Number(g.blackElo);
        if (!(we >= 2400 && be >= 2400) || published.has(g.headers.GameURL || g.headers.Site)) continue;
        const played = day(g.headers.UTCDate) ?? day(g.headers.Date);
        if (played && Date.parse(`${played}T00:00:00Z`) < now - 5 * DAY) continue;
        fromTour.push({
          pgn: one,
          source: { kind: "broadcast", url: g.headers.GameURL || g.headers.Site, event: g.headers.BroadcastName || tour.name, round: round.name, speed: tour.info?.fideTC ?? "standard" },
          played,
          rank: rankOf(we, be, g.result),
        });
      }
    }
    out.push(...fromTour.sort((a, b) => b.rank - a.rank).slice(0, 2));
  }
  return out.filter((c) => c.source.url?.startsWith("https://lichess.org/"));
}

interface Leaderboards {
  live_blitz?: { username: string }[];
  live_rapid?: { username: string }[];
}
interface ChesscomGame {
  url: string;
  pgn?: string;
  rules?: string;
  rated?: boolean;
  time_class?: string;
  end_time?: number;
  white?: { username: string; rating: number };
  black?: { username: string; rating: number };
}

/** Recent blitz and rapid games of Chess.com's top-rated players, leaving out `published` ones. */
export async function chesscomCandidates(fetcher: Fetcher, now = Date.now(), published = new Set<string>()): Promise<Candidate[]> {
  const boards = await json<Leaderboards>(fetcher, "https://api.chess.com/pub/leaderboards");
  const users = [...new Set([...(boards?.live_blitz ?? []).slice(0, 5), ...(boards?.live_rapid ?? []).slice(0, 5)].map((p) => p.username.toLowerCase()))];
  const months = [new Date(now), new Date(now - 3 * DAY)].map((d) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  const out: Candidate[] = [];
  for (const user of users) {
    const games: ChesscomGame[] = [];
    for (const m of [...new Set(months)]) games.push(...((await json<{ games?: ChesscomGame[] }>(fetcher, `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${m}`))?.games ?? []));
    const picks: Candidate[] = [];
    for (const cg of games) {
      if (!cg.pgn || published.has(cg.url) || cg.rules !== "chess" || !cg.rated || !["blitz", "rapid"].includes(cg.time_class ?? "") || !cg.end_time || cg.end_time * 1000 < now - 3 * DAY) continue;
      const opponent = cg.white?.username.toLowerCase() === user ? cg.black : cg.white;
      if (!opponent || opponent.rating < 2600) continue;
      const g = tryParse(cg.pgn);
      if (!g || !FINISHED.has(g.result) || g.moves.length < 50) continue;
      picks.push({
        pgn: cg.pgn,
        source: { kind: "chesscom", url: cg.url, event: `Chess.com ${cg.time_class}`, speed: cg.time_class },
        played: day(g.headers.UTCDate) ?? day(g.headers.Date) ?? new Date(cg.end_time * 1000).toISOString().slice(0, 10),
        rank: rankOf(cg.white?.rating ?? 0, cg.black?.rating ?? 0, g.result),
      });
    }
    const best = picks.sort((a, b) => b.rank - a.rank)[0];
    if (best) out.push(best);
  }
  return out.filter((c) => c.source.url?.startsWith("https://www.chess.com/"));
}

/** The day's picks: the best `broadcasts` over-the-board games and `online` Chess.com games not published yet. */
export async function pickCandidates(fetcher: Fetcher, published: Set<string>, { broadcasts = 4, online = 3, now = Date.now() } = {}): Promise<Candidate[]> {
  const fresh = (list: Candidate[]) => {
    const urls = new Set<string>();
    return list.filter((c) => !urls.has(c.source.url) && urls.add(c.source.url)).sort((a, b) => b.rank - a.rank);
  };
  const [otb, web] = await Promise.all([broadcastCandidates(fetcher, now, published), chesscomCandidates(fetcher, now, published)]);
  return [...fresh(otb).slice(0, broadcasts), ...fresh(web).slice(0, online)];
}
