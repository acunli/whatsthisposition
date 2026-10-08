"use client";

import { useRef, useState } from "react";
import type { Color } from "@/lib/chess/types";
import type { GameSummary } from "@/lib/review/importers";
import { PgnError, parseGame, splitGames, type ParsedGame } from "@/lib/review/pgn";
import { CLASSIC_GAMES } from "@/lib/review/samples";

type Source = "chesscom" | "lichess" | "pgn";

interface Props {
  onGame: (game: ParsedGame, orientation?: Color) => void;
}

const SOURCES: [Source, string][] = [
  ["chesscom", "Chess.com"],
  ["lichess", "Lichess"],
  ["pgn", "PGN"],
];

const RESULT_TEXT: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "…" };

function when(ms?: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Bring a game in: Chess.com / Lichess username, a Lichess game link, or a pasted / uploaded PGN. */
export function GameImport({ onGame }: Props) {
  const [source, setSource] = useState<Source>("chesscom");
  const [user, setUser] = useState("");
  const [pgn, setPgn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<{ owner: string; list: GameSummary[] } | null>(null);
  const [pgnGames, setPgnGames] = useState<ParsedGame[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const open = (text: string, orientation?: Color) => {
    try {
      onGame(parseGame(text), orientation);
    } catch (e) {
      setError(e instanceof PgnError ? e.message : "That game couldn't be read.");
    }
  };

  const fetchGames = async () => {
    const q = user.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setGames(null);
    const isLink = /lichess\.org\/|chess\.com\//i.test(q);
    const url = isLink ? `/api/games?link=${encodeURIComponent(q)}` : `/api/games?site=${source}&user=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { ok: true; games: GameSummary[] } | { ok: false; message: string };
      if (!data.ok) setError(data.message);
      else if (isLink && data.games[0]) open(data.games[0].pgn);
      else if (!data.games.length) setError("No recent standard games found for that player.");
      else setGames({ owner: q.toLowerCase(), list: data.games });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const reviewPgn = (text: string) => {
    setError(null);
    const parts = splitGames(text);
    if (!parts.length) {
      setError("Paste a PGN or a move list first.");
      return;
    }
    if (parts.length === 1) return open(parts[0]);
    const parsed: ParsedGame[] = [];
    for (const p of parts.slice(0, 50)) {
      try {
        parsed.push(parseGame(p));
      } catch {
        /* skip unreadable games in a collection */
      }
    }
    if (!parsed.length) setError("None of the games in that PGN could be read.");
    else if (parsed.length === 1) onGame(parsed[0]);
    else setPgnGames(parsed);
  };

  return (
    <div className="gimport">
      <div className="gimport-head">
        <span className="eyebrow">Review a whole game</span>
        <div className="tabs gimport-tabs" role="tablist" aria-label="Where is the game?">
          {SOURCES.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={source === id}
              className={source === id ? "tab tab-on" : "tab"}
              onClick={() => {
                setSource(id);
                setError(null);
                setGames(null);
                setPgnGames(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {source !== "pgn" ? (
        <form
          className="dock-fen"
          onSubmit={(e) => {
            e.preventDefault();
            void fetchGames();
          }}
        >
          <input
            className="input"
            placeholder={source === "chesscom" ? "Chess.com username" : "Lichess username or game link"}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            aria-label={source === "chesscom" ? "Chess.com username" : "Lichess username or game link"}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button className="btn btn-primary" disabled={!user.trim() || busy}>
            {busy ? "Fetching…" : source === "lichess" && /lichess\.org\//i.test(user) ? "Review" : "Find games"}
          </button>
        </form>
      ) : (
        <div className="gimport-pgn">
          <textarea
            className="input gimport-text"
            placeholder={'Paste a PGN, e.g. from Chess.com (Share → PGN) or Lichess (Share & export), or a move list: 1. e4 e5 2. Nf3 Nc6 …'}
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            aria-label="PGN"
            spellCheck={false}
            rows={4}
          />
          <div className="row">
            <button className="btn btn-primary" disabled={!pgn.trim()} onClick={() => reviewPgn(pgn)}>
              Review game
            </button>
            <button className="btn btn-ghost" onClick={() => file.current?.click()}>
              Upload .pgn
            </button>
            <input
              ref={file}
              type="file"
              accept=".pgn,.txt,application/x-chess-pgn,text/plain"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) return setError("That file is over 5 MB. Export a single game instead.");
                const text = await f.text();
                setPgn(text);
                reviewPgn(text);
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="hero-issue" role="alert">
          {error}
        </p>
      )}

      {games && (
        <ul className="glist" aria-label="Recent games">
          {games.list.map((g) => {
            const mine: Color | undefined = g.white.toLowerCase() === games.owner ? "w" : g.black.toLowerCase() === games.owner ? "b" : undefined;
            return (
              <li key={g.id}>
                <button className="glist-item" onClick={() => open(g.pgn, mine)}>
                  <span className="glist-players">
                    <span className="side-dot side-w" aria-hidden /> {g.white} {g.whiteElo ? <span className="muted mono">{g.whiteElo}</span> : null}
                    <span className="muted"> vs </span>
                    <span className="side-dot side-b" aria-hidden /> {g.black} {g.blackElo ? <span className="muted mono">{g.blackElo}</span> : null}
                  </span>
                  <span className="glist-meta small muted">
                    <b className="mono">{RESULT_TEXT[g.result] ?? g.result}</b>
                    {g.speed ? ` · ${g.speed}` : ""}
                    {g.playedAt ? ` · ${when(g.playedAt)}` : ""}
                    {g.opening ? ` · ${g.opening}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pgnGames && (
        <ul className="glist" aria-label="Games in this PGN">
          {pgnGames.map((g, i) => (
            <li key={i}>
              <button className="glist-item" onClick={() => onGame(g)}>
                <span className="glist-players">
                  {g.white} <span className="muted">vs</span> {g.black}
                </span>
                <span className="glist-meta small muted">
                  <b className="mono">{RESULT_TEXT[g.result] ?? g.result}</b> · {Math.ceil(g.moves.length / 2)} moves{g.headers.Event ? ` · ${g.headers.Event}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="dock-row">
        <span className="small muted">Try a classic:</span>
        {CLASSIC_GAMES.map((g) => (
          <button key={g.id} className="chip" onClick={() => open(g.pgn)}>
            {g.name}
          </button>
        ))}
      </div>
    </div>
  );
}
