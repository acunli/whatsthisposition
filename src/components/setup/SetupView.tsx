"use client";

import { useMemo, useState } from "react";
import { BoardStage } from "../BoardStage";
import { PhotoInput } from "./PhotoInput";
import { PiecePalette, type Tool } from "./PiecePalette";
import {
  EMPTY_CASTLING,
  START_FEN,
  boardToFenField,
  castlingToField,
  gameStatus,
  parseFen,
  possibleCastling,
  possibleEpSquares,
  setupFromFen,
  setupToFen,
  validateSetup,
  type Issue,
} from "@/lib/chess/fen";
import { clonePlacement } from "@/lib/chess/board";
import type { CastlingRights, Color, PieceSymbol, Placement, PositionSetup, Square } from "@/lib/chess/types";

type Tab = "photo" | "fen" | "hand";

interface Props {
  setup: PositionSetup;
  onChange: (s: PositionSetup) => void;
  orientation: Color;
  onOrientation: (c: Color) => void;
  onAnalyze: (s: PositionSetup) => void;
  initialPhoto?: File | null;
  onPhotoConsumed?: () => void;
}

function withPlacement(s: PositionSetup, placement: Placement): PositionSetup {
  // Never keep rights the pieces no longer allow; never add rights on our own.
  const allowed = possibleCastling(placement);
  const castling: CastlingRights = {
    K: s.castling.K && allowed.K,
    Q: s.castling.Q && allowed.Q,
    k: s.castling.k && allowed.k,
    q: s.castling.q && allowed.q,
  };
  const ep = s.epSquare && s.turn && possibleEpSquares(placement, s.turn).includes(s.epSquare) ? s.epSquare : null;
  return { ...s, placement, castling, epSquare: ep };
}

export function SetupView({ setup, onChange, orientation, onOrientation, onAnalyze, initialPhoto, onPhotoConsumed }: Props) {
  const [tab, setTab] = useState<Tab>(initialPhoto ? "photo" : "hand");
  const [tool, setTool] = useState<Tool>("move");
  const [from, setFrom] = useState<Square | null>(null);
  const [uncertain, setUncertain] = useState<Square[]>([]);
  const [fenText, setFenText] = useState("");
  const [fenIssues, setFenIssues] = useState<Issue[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  const issues = useMemo(() => validateSetup(setup), [setup]);
  const status = useMemo(() => (issues.length === 0 ? gameStatus(setupToFen(setup)) : null), [issues, setup]);
  const problemSquares = issues.flatMap((i) => i.squares ?? []);
  const allowedCastling = possibleCastling(setup.placement);
  const epOptions = setup.turn ? possibleEpSquares(setup.placement, setup.turn) : [];
  const currentFen = setup.turn ? setupToFen(setup) : `${boardToFenField(setup.placement)} ? ${castlingToField(setup.castling)} ${setup.epSquare ?? "-"}`;
  const blocking = issues.length > 0 || uncertain.length > 0 || (status && status.kind !== "ongoing" && status.kind !== "insufficient");

  const editSquare = (sq: Square) => {
    const p = clonePlacement(setup.placement);
    setUncertain((u) => u.filter((x) => x !== sq));
    if (tool === "move") {
      if (from) {
        if (from !== sq && p[from]) {
          p[sq] = p[from];
          delete p[from];
          setUncertain((u) => u.filter((x) => x !== from));
          onChange(withPlacement(setup, p));
        }
        setFrom(null);
      } else if (p[sq]) setFrom(sq);
      return;
    }
    if (tool === "erase") delete p[sq];
    else {
      const piece = { color: tool[0] as Color, type: tool[1].toLowerCase() as PieceSymbol };
      const cur = p[sq];
      if (cur && cur.color === piece.color && cur.type === piece.type) delete p[sq];
      else p[sq] = piece;
    }
    onChange(withPlacement(setup, p));
  };

  const loadFen = (text: string) => {
    const r = parseFen(text);
    if (!r.ok) {
      setFenIssues(r.issues);
      return;
    }
    setFenIssues([]);
    setUncertain([]);
    setPhotoNote(null);
    onChange(r.setup);
  };

  return (
    <main className="setup">
      <section className="setup-board" aria-label="Board editor">
        <BoardStage
          placement={setup.placement}
          orientation={orientation}
          selected={from}
          uncertain={uncertain}
          problems={problemSquares}
          onSquareClick={editSquare}
          label="Editable chessboard"
        />
        <PiecePalette
          tool={tool}
          onTool={(t) => {
            setTool(t);
            setFrom(null);
          }}
          onClear={() => {
            setUncertain([]);
            onChange({ ...setup, placement: {}, castling: { ...EMPTY_CASTLING }, epSquare: null });
          }}
          onStart={() => {
            setUncertain([]);
            onChange(setupFromFen(START_FEN));
          }}
          onFlip={() => onOrientation(orientation === "w" ? "b" : "w")}
        />
        <p className="hint">
          {tool === "move"
            ? from
              ? `Moving the piece on ${from}: tap where it goes.`
              : "Tap a piece, then a square, to move it. Pick a piece above to place it."
            : tool === "erase"
              ? "Tap pieces to remove them."
              : "Tap squares to place this piece; tap again to remove it."}
        </p>
      </section>

      <section>
        <div className="eyebrow">Step 1 of 2</div>
        <h1 className="page-title">Set the board</h1>

        <div className="panel">
          <h2 className="panel-title">
            <span className="n">1</span> Where&apos;s the position from?
          </h2>
          <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
            {(
              [
                ["photo", "Photo"],
                ["fen", "FEN"],
                ["hand", "By hand"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "tab tab-on" : "tab"} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "photo" && (
            <PhotoInput
              initialFile={initialPhoto ?? null}
              onInitialConsumed={onPhotoConsumed}
              onRecognized={(placement, unsure, notes, whiteAtBottom) => {
                setUncertain(unsure);
                setPhotoNote(notes || null);
                onOrientation(whiteAtBottom ? "w" : "b");
                // A photo can't show whose move it is, castling rights or en passant.
                onChange({ placement, turn: null, castling: { ...EMPTY_CASTLING }, epSquare: null, halfmove: 0, fullmove: 1 });
              }}
            />
          )}

          {tab === "fen" && (
            <div>
              <textarea
                className="input"
                rows={3}
                spellCheck={false}
                placeholder="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
                value={fenText}
                onChange={(e) => setFenText(e.target.value)}
                aria-label="FEN"
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => loadFen(fenText)} disabled={!fenText.trim()}>
                  Load FEN
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setFenText(currentFen.includes("?") ? "" : currentFen)}>
                  Copy board into box
                </button>
              </div>
              {fenIssues.map((i) => (
                <p key={i.code} className="issue" style={{ marginTop: 10 }}>
                  {i.message}
                </p>
              ))}
            </div>
          )}

          {tab === "hand" && (
            <p className="small muted" style={{ margin: 0 }}>
              Use the tools under the board: pick a piece, tap squares. Start from the initial position or clear the board.
            </p>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">
            <span className="n">2</span> Position details
          </h2>

          <fieldset className={`field ${!setup.turn ? "field-required" : ""}`}>
            <legend className="field-label">Whose move is it?</legend>
            <div className="seg-group">
              {(["w", "b"] as Color[]).map((c) => (
                <button
                  key={c}
                  aria-pressed={setup.turn === c}
                  className={setup.turn === c ? "seg seg-on" : "seg"}
                  onClick={() => onChange(withPlacement({ ...setup, turn: c }, setup.placement))}
                >
                  <span className={`side-dot side-${c}`} aria-hidden /> {c === "w" ? "White" : "Black"} to move
                </button>
              ))}
            </div>
            {!setup.turn && <p className="field-note">A photo can&apos;t show whose turn it is, so you choose.</p>}
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Castling still allowed</legend>
            <div className="checks">
              {(
                [
                  ["K", "White O-O"],
                  ["Q", "White O-O-O"],
                  ["k", "Black O-O"],
                  ["q", "Black O-O-O"],
                ] as [keyof CastlingRights, string][]
              ).map(([k, label]) => (
                <label key={k} className={allowedCastling[k] ? "check" : "check check-off"} title={allowedCastling[k] ? "" : "King or rook isn't on its starting square"}>
                  <input
                    type="checkbox"
                    checked={setup.castling[k]}
                    disabled={!allowedCastling[k]}
                    onChange={(e) => onChange({ ...setup, castling: { ...setup.castling, [k]: e.target.checked } })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="field-note">Only you know if the king or rooks have moved. Leave unticked if unsure.</p>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">En passant</legend>
            <select
              className="select"
              value={setup.epSquare ?? ""}
              onChange={(e) => onChange({ ...setup, epSquare: (e.target.value || null) as Square | null })}
              disabled={!epOptions.length}
            >
              <option value="">{epOptions.length ? "Not available" : "Not possible here"}</option>
              {epOptions.map((s) => (
                <option key={s} value={s}>
                  Capture on {s} (last move was a two-square pawn push)
                </option>
              ))}
            </select>
          </fieldset>

          <div className="fen-readout">
            <span className="field-label">FEN</span>
            <code>{currentFen}</code>
          </div>
        </div>

        <div className="issues" aria-live="polite">
          {uncertain.length > 0 && (
            <p className="issue issue-warn">
              Check {uncertain.length} square{uncertain.length > 1 ? "s" : ""} marked <b>?</b> ({uncertain.slice(0, 6).join(", ")}
              {uncertain.length > 6 ? "…" : ""}). Tap each to fix it, or{" "}
              <button className="linkish" onClick={() => setUncertain([])}>
                confirm they&apos;re right
              </button>
              .
            </p>
          )}
          {photoNote && <p className="issue issue-note">From the photo reader: {photoNote}</p>}
          {issues.map((i) => (
            <p key={i.code} className="issue">
              {i.message}
            </p>
          ))}
          {status && status.kind !== "ongoing" && <p className={status.kind === "insufficient" ? "issue issue-note" : "issue"}>{status.message}</p>}
        </div>

        <button className="btn btn-gold btn-big btn-wide" disabled={!!blocking} onClick={() => onAnalyze(setup)}>
          X-ray this position →
        </button>
      </section>
    </main>
  );
}
