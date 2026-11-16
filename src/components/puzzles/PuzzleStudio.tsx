"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { commonPlayer } from "@/lib/puzzles/build";
import { forgetPuzzles, keepPuzzles, keptPuzzles, type KeptPuzzles } from "@/lib/puzzles/store";
import type { Outcome } from "@/lib/puzzles/types";
import type { GameSummary, Site } from "@/lib/review/importers";
import { parseGame, splitGames, type ParsedGame } from "@/lib/review/pgn";
import { rememberPlayer, rememberedPlayer } from "@/lib/review/player";
import { countUse } from "@/lib/usage";
import { PuzzleTrainer } from "./PuzzleTrainer";
import { PUZZLE_DEPTH, usePuzzleMaker, type MakerGame } from "./usePuzzleMaker";

/** More games than this would keep the engine busy for too long in one go. */
const MAX_GAMES = 20;
const FIRST_PICK = 8;

type Source = Site | "pgn";
const SOURCES: [Source, string][] = [
  ["chesscom", "Chess.com"],
  ["lichess", "Lichess"],
  ["pgn", "PGN"],
];
const RESULT: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½" };
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * Puzzles from a player's own games: pick the games, the browser reviews them, and the
 * mistakes come back as what the player gets wrong most and positions to practise on
 * (lib/puzzles). The last set is kept in this browser, with how far the player got.
 */
export function PuzzleStudio() {
  const maker = usePuzzleMaker();
  const [kept, setKept] = useState<KeptPuzzles | null>(null);
  const [view, setView] = useState<"pick" | "train">("pick");
  const [source, setSource] = useState<Source>("chesscom");
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ name: string; list: GameSummary[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pgn, setPgn] = useState("");
  const [who, setWho] = useState("");

  // What this browser kept from last time, read once the page is up (the server has no storage).
  useEffect(() => {
    queueMicrotask(() => {
      const before = keptPuzzles();
      if (before) {
        setKept(before);
        setView("train");
      }
      const p = rememberedPlayer();
      if (p) {
        setSource(p.site);
        setUser(p.user);
      }
    });
  }, []);

  // A finished set replaces the kept one and opens the trainer.
  const made = maker.state.status === "done" ? maker.state.set : null;
  useEffect(() => {
    if (!made) return;
    queueMicrotask(() => {
      const next = { set: made, done: {}, at: 0 };
      keepPuzzles(next);
      setKept(next);
      setView("train");
      maker.cancel();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished set
  }, [made]);

  const update = useCallback((change: (k: KeptPuzzles) => KeptPuzzles) => {
    setKept((k) => {
      if (!k) return k;
      const next = change(k);
      keepPuzzles(next);
      return next;
    });
  }, []);

  const find = async () => {
    const q = user.trim();
    if (!q || source === "pgn") return;
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const res = await fetch(`/api/games?site=${source}&user=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { ok: true; games: GameSummary[] } | { ok: false; message: string };
      if (!data.ok) setError(data.message);
      else if (!data.games.length) setError("No recent standard games found for that player.");
      else {
        rememberPlayer(source, q);
        setFound({ name: q, list: data.games });
        setPicked(new Set(data.games.slice(0, FIRST_PICK).map((g) => g.id)));
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  // The games in the pasted PGN, and the names in them.
  const pasted = useMemo(() => {
    const games: ParsedGame[] = [];
    const texts: string[] = [];
    for (const t of splitGames(pgn).slice(0, 60)) {
      try {
        games.push(parseGame(t));
        texts.push(t);
      } catch {
        // A game that doesn't parse is left out; the count below says how many were read.
      }
    }
    const names = [...new Set(games.flatMap((g) => [g.white, g.black]).filter((n) => n && n !== "?"))];
    return { games, texts, names, likely: commonPlayer(games) };
  }, [pgn]);
  const pgnPlayer = who && pasted.names.includes(who) ? who : (pasted.likely ?? pasted.names[0] ?? "");

  const start = (games: MakerGame[], player: string, from: Source) => {
    setError(null);
    countUse("puzzles", from);
    maker.start(games.slice(0, MAX_GAMES), player);
  };

  const working = maker.state.status === "working" ? maker.state : null;
  const chosen = found ? found.list.filter((g) => picked.has(g.id)) : [];

  if (view === "train" && kept && !working) {
    return (
      <PuzzleTrainer
        set={kept.set}
        done={kept.done}
        at={kept.at}
        onAt={(i) => update((k) => ({ ...k, at: i }))}
        onOutcome={(id: string, o: Outcome) => update((k) => ({ ...k, done: { ...k.done, [id]: o } }))}
        onNewSet={() => setView("pick")}
      />
    );
  }

  return (
    <section className="section pz-pick">
      <h1 className="h-section">Puzzles from your own games</h1>
      <p className="section-lede">
        Choose some of your games. Stockfish reviews them in your browser, sorts your mistakes by what went wrong, and turns them into positions to solve: the moves you missed, and
        the ones you walked into.
      </p>

      {working ? (
        <div className="pz-working" role="status" aria-live="polite">
          <p>
            <b>
              Reviewing game {working.game + 1} of {working.games}
            </b>
            {working.label ? `: ${working.label}` : ""}
          </p>
          <div className="rv-progress-bar">
            <span style={{ width: `${Math.round(((working.game + working.share) / working.games) * 100)}%` }} />
          </div>
          <p className="small muted">
            {plural(working.engines, "engine")} at depth {PUZZLE_DEPTH}, sharp moments searched deeper. This is your own device working; nothing is uploaded.
          </p>
          <button className="btn btn-sm" onClick={maker.cancel}>
            Stop
          </button>
        </div>
      ) : (
        <>
          {kept && (
            <p className="pz-back">
              <button className="linkish" onClick={() => setView("train")}>
                Back to the set you have
              </button>{" "}
              <span className="small muted">
                ({plural(kept.set.puzzles.length, "puzzle")} from {plural(kept.set.games, "game")}, {day(kept.set.made)})
              </span>{" "}
              <button
                className="linkish"
                onClick={() => {
                  forgetPuzzles();
                  setKept(null);
                }}
              >
                Delete it
              </button>
            </p>
          )}
          <div className="tabs pz-tabs" role="tablist" aria-label="Where are the games?">
            {SOURCES.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={source === id}
                className={source === id ? "tab tab-on" : "tab"}
                onClick={() => {
                  setSource(id);
                  setError(null);
                  setFound(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {source !== "pgn" ? (
            <form
              className="dock-fen"
              onSubmit={(e) => {
                e.preventDefault();
                void find();
              }}
            >
              <input
                className="input"
                placeholder={source === "chesscom" ? "Chess.com username" : "Lichess username"}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                aria-label={source === "chesscom" ? "Chess.com username" : "Lichess username"}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
              />
              <button className="btn btn-primary" disabled={!user.trim() || busy}>
                {busy ? "Fetching…" : "Find games"}
              </button>
            </form>
          ) : (
            <div className="gimport-pgn">
              <textarea
                className="input gimport-text"
                placeholder="Paste several games as PGN, one after another (a file exported from Chess.com, Lichess or a database)."
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
                aria-label="PGN of several games"
                spellCheck={false}
                rows={6}
              />
              {pasted.games.length > 0 && (
                <div className="pz-who">
                  <label>
                    <span className="small muted">Whose mistakes? </span>
                    <select className="select select-sm" value={pgnPlayer} onChange={(e) => setWho(e.target.value)}>
                      {pasted.names.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={!pgnPlayer}
                    onClick={() =>
                      start(
                        pasted.texts.map((t) => ({ pgn: t })),
                        pgnPlayer,
                        "pgn",
                      )
                    }
                  >
                    Make puzzles from {plural(Math.min(MAX_GAMES, pasted.games.length), "game")}
                  </button>
                </div>
              )}
              {pgn.trim() && !pasted.games.length && <p className="hero-issue">No game could be read from that text.</p>}
              {pasted.games.length > MAX_GAMES && <p className="small muted">The first {MAX_GAMES} games are used.</p>}
            </div>
          )}

          {(error || maker.state.status === "error") && (
            <p className="hero-issue" role="alert">
              {error ?? (maker.state.status === "error" ? maker.state.message : "")}
            </p>
          )}

          {found && source !== "pgn" && (
            <>
              <div className="glist-head small">
                <span>
                  <b>{found.name}</b>&apos;s latest games: {chosen.length} chosen
                </span>
                <span className="pz-select">
                  <button className="glist-forget" onClick={() => setPicked(new Set(found.list.slice(0, MAX_GAMES).map((g) => g.id)))}>
                    All
                  </button>
                  <button className="glist-forget" onClick={() => setPicked(new Set())}>
                    None
                  </button>
                </span>
              </div>
              <ul className="glist pz-games" aria-label="Recent games">
                {found.list.slice(0, MAX_GAMES).map((g) => (
                  <li key={g.id}>
                    <label className="glist-item pz-game">
                      <input
                        type="checkbox"
                        checked={picked.has(g.id)}
                        onChange={(e) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(g.id);
                            else next.delete(g.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        <span className="glist-players">
                          <span className="side-dot side-w" aria-hidden /> {g.white} {g.whiteElo ? <span className="muted mono">{g.whiteElo}</span> : null}
                          <span className="muted"> vs </span>
                          <span className="side-dot side-b" aria-hidden /> {g.black} {g.blackElo ? <span className="muted mono">{g.blackElo}</span> : null}
                        </span>
                        <span className="glist-meta small muted">
                          <b className="mono">{RESULT[g.result] ?? g.result}</b>
                          {g.speed ? `, ${g.speed}` : ""}
                          {g.playedAt ? `, ${day(g.playedAt)}` : ""}
                          {g.opening ? `, ${g.opening}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="pz-go">
                <button
                  className="btn btn-primary"
                  disabled={!chosen.length}
                  onClick={() =>
                    start(
                      chosen.map((g) => ({ pgn: g.pgn, url: g.url })),
                      found.name,
                      source,
                    )
                  }
                >
                  Make puzzles from {plural(chosen.length, "game")}
                </button>
                <span className="small muted">About ten to twenty seconds a game on a computer, longer on a phone.</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
