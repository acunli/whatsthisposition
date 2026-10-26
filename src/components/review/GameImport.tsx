"use client";

import { IMPORT_ERRORS, IMPORT_SITES, countUse } from "@/lib/usage";
import { useRef, useState } from "react";
import { parseFen } from "@/lib/chess/fen";
import type { Color } from "@/lib/chess/types";
import { profileLink, type GameSummary, type Site } from "@/lib/review/importers";
import { PgnError, parseGame, splitGames, type ParsedGame } from "@/lib/review/pgn";
import { CLASSIC_GAMES } from "@/lib/review/samples";

export type ImportSource = "chesscom" | "lichess" | "pgn";

interface Props {
  onGame: (game: ParsedGame, orientation?: Color) => void;
  /** The tab it opens on (Chess.com unless a page says otherwise). */
  initialSource?: ImportSource;
}

const SOURCES: [ImportSource, string][] = [
  ["chesscom", "Chess.com"],
  ["lichess", "Lichess"],
  ["pgn", "PGN"],
];

/** A Chess.com or Lichess link: a game, which either site's box (or the PGN box) opens straight away, or a player's page. */
const GAME_LINK = /lichess\.org\/|chess\.com\//i;

const RESULT_TEXT: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½", "*": "…" };

function when(ms?: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Bring a game in: Chess.com / Lichess username or game link, or a pasted / uploaded PGN. */
export function GameImport({ onGame: openGame, initialSource = "chesscom" }: Props) {
  const [source, setSource] = useState<ImportSource>(initialSource);
  const fromFile = useRef(false);
  /** A review starts: counted (anonymously) by where the game came from. */
  const onGame = (g: ParsedGame, orientation?: Color) => {
    countUse("review", source === "pgn" ? (fromFile.current ? "file" : "pgn") : source);
    openGame(g, orientation);
  };
  const [user, setUser] = useState("");
  const [pgn, setPgn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<{ owner: string; list: GameSummary[] } | null>(null);
  const [pgnGames, setPgnGames] = useState<ParsedGame[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /** A game that couldn't be brought in: counted (anonymously) by where and why, never what was typed. */
  const failed = (where: (typeof IMPORT_SITES)[number], why: (typeof IMPORT_ERRORS)[number]) => countUse("import_error", `${where}.${why}`);

  const open = (text: string, orientation?: Color, where: (typeof IMPORT_SITES)[number] = fromFile.current ? "file" : "pgn") => {
    try {
      onGame(parseGame(text), orientation);
    } catch (e) {
      setError(e instanceof PgnError ? e.message : "That game couldn't be read.");
      failed(where, "unreadable");
    }
  };

  /** A username's recent games, or the game at a link (typed in either site's box, or pasted as the PGN). */
  const fetchGames = async (text = user) => {
    let q = text.trim().replace(/^@/, "");
    if (!q) return;
    setBusy(true);
    setError(null);
    setGames(null);
    let site: Site = source === "lichess" ? "lichess" : "chesscom";
    // A player's profile page stands for their games, on the site it's from.
    const profile = profileLink(q);
    if (profile) {
      q = profile.user;
      site = profile.site;
      setSource(site);
    }
    const isLink = !profile && GAME_LINK.test(q);
    const url = isLink ? `/api/games?link=${encodeURIComponent(q)}` : `/api/games?site=${site}&user=${encodeURIComponent(q)}`;
    const where = isLink ? "link" : site;
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { ok: true; games: GameSummary[] } | { ok: false; message: string };
      if (!data.ok) {
        setError(data.message);
        failed(where, res.status === 404 ? "notfound" : res.status === 429 ? "limited" : "failed");
      } else if (isLink && data.games[0]) {
        countUse("lookup", "link");
        open(data.games[0].pgn, undefined, "link");
      } else if (!data.games.length) {
        setError("No recent standard games found for that player.");
        failed(where, "empty");
      } else {
        countUse("lookup", where);
        setGames({ owner: q.toLowerCase(), list: data.games });
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      failed(where, "offline");
    } finally {
      setBusy(false);
    }
  };

  const reviewPgn = (text: string) => {
    setError(null);
    const t = text.trim();
    // A game link (or a player's page) pasted here instead of in a site's box.
    if (GAME_LINK.test(t) && !/\s/.test(t)) return void fetchGames(t);
    if (t.includes("/") && !/\d\./.test(t) && parseFen(t).ok) {
      setError("That's a single position (a FEN), not a game: analyse it as a single position instead.");
      failed(fromFile.current ? "file" : "pgn", "unreadable");
      return;
    }
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
    if (!parsed.length) {
      setError("None of the games in that PGN could be read.");
      failed(fromFile.current ? "file" : "pgn", "unreadable");
    } else if (parsed.length === 1) onGame(parsed[0]);
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
            placeholder={source === "chesscom" ? "Chess.com username or game link" : "Lichess username or game link"}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            aria-label={source === "chesscom" ? "Chess.com username or game link" : "Lichess username or game link"}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button className="btn btn-primary" disabled={!user.trim() || busy}>
            {busy ? "Fetching…" : GAME_LINK.test(user) && !profileLink(user) ? "Review" : "Find games"}
          </button>
        </form>
      ) : (
        <div className="gimport-pgn">
          <textarea
            className="input gimport-text"
            placeholder={'Paste a PGN, e.g. from Chess.com (Share → PGN) or Lichess (Share & export), or a move list: 1. e4 e5 2. Nf3 Nc6 …'}
            value={pgn}
            onChange={(e) => {
              fromFile.current = false;
              setPgn(e.target.value);
            }}
            aria-label="PGN"
            spellCheck={false}
            rows={4}
          />
          <div className="row">
            <button className="btn btn-primary" disabled={!pgn.trim() || busy} onClick={() => reviewPgn(pgn)}>
              {busy ? "Fetching…" : "Review game"}
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
                fromFile.current = true;
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
                <button className="glist-item" onClick={() => open(g.pgn, mine, source === "lichess" ? "lichess" : "chesscom")}>
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
