import { describe, expect, it } from "vitest";
import type { ClassifiedMove, MoveClass } from "../review/classify";
import { displayName, gameSlug, longDate, pageSide, pickMoments, resultWords, slugify } from "./games";
import { pickCandidates, type Fetcher } from "./sources";

const moves = (labels: MoveClass[], loss: number[] = []) => labels.map((cls, i) => ({ cls, loss: loss[i] ?? 0, move: { ply: i + 1, color: i % 2 ? "b" : "w" } }) as unknown as ClassifiedMove);

describe("a reviewed game's page", () => {
  it("writes broadcast names first name first, and keeps usernames", () => {
    expect(displayName("Giri, Anish")).toBe("Anish Giri");
    expect(displayName("MagnusCarlsen")).toBe("MagnusCarlsen");
    expect(displayName("a, b, c")).toBe("a, b, c");
  });

  it("gets a short, readable address, unique among the others", () => {
    expect(slugify("Ding Liren vs Gukesh D, Ünited Cup | Open")).toBe("ding-liren-vs-gukesh-d-united-cup-open");
    const taken = new Set<string>();
    const a = gameSlug("Anish Giri", "Sergei Movsesian", "European Club Cup | Open", "2026-10-19", taken);
    expect(a).toBe("anish-giri-vs-sergei-movsesian-2026-10-19");
    taken.add(a);
    const b = gameSlug("Anish Giri", "Sergei Movsesian", "European Club Cup | Open", "2026-10-19", taken);
    expect(b).toBe("anish-giri-vs-sergei-movsesian-european-club-cup-open-2026-10-19");
    taken.add(b);
    expect(gameSlug("Anish Giri", "Sergei Movsesian", "European Club Cup | Open", "2026-10-19", taken)).toBe(`${b}-2`);
  });

  it("tells every Brilliant and Great move first, then the costliest errors, in game order", () => {
    const m = moves(["book", "blunder", "best", "great", "mistake", "brilliant", "miss", "inaccuracy"], [0, 0.4, 0, 0, 0.15, 0, 0.2, 0.05]);
    expect(pickMoments(m).map((x) => x.cls)).toEqual(["blunder", "great", "mistake", "brilliant", "miss"]);
    expect(pickMoments(m, 3).map((x) => x.cls)).toEqual(["blunder", "great", "brilliant"]);
  });

  it("is drawn for whoever found a Brilliant or Great move, else the winner", () => {
    expect(pageSide(moves(["good", "great"]), "1-0")).toBe("b");
    expect(pageSide(moves(["great", "brilliant"]), "1-0")).toBe("b");
    expect(pageSide(moves(["good", "good"]), "0-1")).toBe("b");
    expect(pageSide(moves(["good", "good"]), "1/2-1/2")).toBe("w");
  });

  it("says the date and result in words", () => {
    expect(longDate("2026-10-19")).toBe("19 October 2026");
    expect(resultWords("0-1", "A", "B")).toBe("B won");
    expect(resultWords("1/2-1/2", "A", "B")).toBe("Drawn");
  });
});

/** A fake of the two APIs: one tier-5 broadcast round and Chess.com's leaderboards. */
function fakeApis(now: number): Fetcher {
  const game = (white: string, black: string, we: number, be: number, result: string, url: string, moves = 25) =>
    `[Event "Top Event"]\n[White "${white}"]\n[Black "${black}"]\n[WhiteElo "${we}"]\n[BlackElo "${be}"]\n[Result "${result}"]\n[UTCDate "2026.10.18"]\n[GameURL "${url}"]\n[BroadcastName "Top Event | Open"]\n\n${Array.from({ length: moves }, (_, i) => (i % 2 ? `${i + 1}. Ng1 Ng8` : `${i + 1}. Nf3 Nf6`)).join(" ")} ${result}\n`;
  const round = [
    game("A, Strong", "B, Strong", 2750, 2700, "1-0", "https://lichess.org/broadcast/x/round-1/r1/g1"),
    game("C, Strong", "D, Strong", 2700, 2690, "1/2-1/2", "https://lichess.org/broadcast/x/round-1/r1/g2"),
    game("E, Weak", "F, Weak", 2300, 2700, "1-0", "https://lichess.org/broadcast/x/round-1/r1/g3"),
    game("G, Short", "H, Short", 2800, 2800, "1-0", "https://lichess.org/broadcast/x/round-1/r1/g4", 10),
    game("I, Live", "J, Live", 2800, 2800, "*", "https://lichess.org/broadcast/x/round-1/r1/g5"),
    game("K, Third", "L, Third", 2650, 2650, "0-1", "https://lichess.org/broadcast/x/round-1/r1/g6"),
  ].join("\n");
  const cc = (opp: number, end: number, url: string, time_class = "blitz") => ({ url, pgn: game("top1", "rival", 3300, opp, "0-1", url, 30), rules: "chess", rated: true, time_class, end_time: Math.floor(end / 1000), white: { username: "top1", rating: 3300 }, black: { username: "rival", rating: opp } });
  const routes: Record<string, unknown> = {
    "https://lichess.org/api/broadcast/top?page=1": { active: [{ tour: { id: "T5", name: "Top Event | Open", tier: 5 } }, { tour: { id: "T3", name: "Small", tier: 3 } }], past: { currentPageResults: [] } },
    "https://lichess.org/api/broadcast/T5": { rounds: [{ id: "r1", name: "Round 1", startsAt: now - 86_400_000 }, { id: "old", name: "Round 0", startsAt: now - 9 * 86_400_000 }] },
    "https://lichess.org/api/broadcast/round/r1.pgn": round,
    "https://api.chess.com/pub/leaderboards": { live_blitz: [{ username: "Top1" }], live_rapid: [] },
  };
  const month = `${new Date(now).getUTCFullYear()}/${String(new Date(now).getUTCMonth() + 1).padStart(2, "0")}`;
  routes[`https://api.chess.com/pub/player/top1/games/${month}`] = {
    games: [cc(2650, now - 3600_000, "https://www.chess.com/game/live/1"), cc(2900, now - 3600_000, "https://www.chess.com/game/live/2", "bullet"), cc(2950, now - 5 * 86_400_000, "https://www.chess.com/game/live/3"), cc(2500, now - 3600_000, "https://www.chess.com/game/live/4")],
  };
  return async (url) => {
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : JSON.stringify(body));
  };
}

describe("the day's picks", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");

  it("takes strong, finished, recent games by general rules, two per event and one per online player", async () => {
    const picks = await pickCandidates(fakeApis(now), new Set(), { now });
    // g6 (2650, decisive: 2700) outranks g2 (2690, drawn); weaker, shorter, unfinished, old and bullet games are left out.
    expect(picks.map((p) => p.source.url)).toEqual(["https://lichess.org/broadcast/x/round-1/r1/g1", "https://lichess.org/broadcast/x/round-1/r1/g6", "https://www.chess.com/game/live/1"]);
    expect(picks[0]).toMatchObject({ played: "2026-10-18", source: { kind: "broadcast", event: "Top Event | Open", round: "Round 1" } });
    expect(picks[2].source).toMatchObject({ kind: "chesscom", event: "Chess.com blitz", speed: "blitz" });
  });

  it("skips games already published", async () => {
    const picks = await pickCandidates(fakeApis(now), new Set(["https://lichess.org/broadcast/x/round-1/r1/g1"]), { now });
    expect(picks.map((p) => p.source.url)).toEqual(["https://lichess.org/broadcast/x/round-1/r1/g6", "https://lichess.org/broadcast/x/round-1/r1/g2", "https://www.chess.com/game/live/1"]);
  });
});
