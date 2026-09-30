"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Board } from "../Board";
import { placementFromFen } from "@/lib/chess/fen";
import { other, type Color, type Square } from "@/lib/chess/types";
import type { EngineLine } from "@/lib/engine/client";
import type { Evaluation } from "@/lib/engine/score";
import { computeFacts, marksForLenses, type LensId, type Marks } from "@/lib/facts";
import { explainMove, explainWhyNot } from "@/lib/facts/explain";
import { threatFact } from "@/lib/facts/engineFacts";
import { findPlans } from "@/lib/facts/plans";
import { traceSquare } from "@/lib/facts/trace";
import { emptyMarks } from "@/lib/facts/types";
import { buildVariation, fenAtPly, moveAtPly, navigate, type NavAction } from "@/lib/variation";
import { EvalBar, EvalHeadline } from "./bits";
import { ComparePanel } from "./ComparePanel";
import { LensPanel } from "./LensPanel";
import { LinesPanel, type LineRef, type WhyState } from "./LinesPanel";
import { PlansPanel } from "./PlansPanel";
import { QuizPanel } from "./QuizPanel";
import { SEARCH_PRESETS, useAnalysis } from "./useAnalysis";
import { VariationBar } from "./VariationBar";

type Panel = "lines" | "compare" | "quiz" | "plans";

interface Props {
  fen: string;
  orientation: Color;
  onOrientation: (c: Color) => void;
  onEdit: () => void;
}

export function AnalysisView({ fen, orientation, onOrientation, onEdit }: Props) {
  const [presetIdx, setPresetIdx] = useState(1);
  const [multipv, setMultipv] = useState(3);
  const settings = SEARCH_PRESETS[presetIdx];
  const a = useAnalysis(fen, settings, multipv);

  const [lenses, setLenses] = useState<LensId[]>(["threats"]);
  const [savedLenses, setSavedLenses] = useState<LensId[]>(["threats"]);
  const [focus, setFocus] = useState<string | null>(null);
  const [hoverFact, setHoverFact] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [line, setLine] = useState<LineRef | null>(null);
  const [ply, setPly] = useState(0);
  const [panel, setPanel] = useState<Panel>("lines");
  const [why, setWhy] = useState<WhyState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Marks | null>(null);
  const [hoverLine, setHoverLine] = useState<EngineLine | null>(null);
  const [pair, setPair] = useState<[number, number]>([1, 2]);
  const [planFocus, setPlanFocus] = useState<string | null>(null);
  const [planHover, setPlanHover] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const lines = useMemo(() => a.snapshot?.lines ?? [], [a.snapshot]);
  const running = a.status === "running" || a.status === "starting";
  const done = a.status === "done" || a.status === "stopped";
  const turn = fen.split(" ")[1] as Color;

  const variation = useMemo(() => (line ? buildVariation(fen, line.pv, 24) : null), [fen, line]);
  const displayFen = variation ? fenAtPly(variation, ply) : fen;
  const atRoot = displayFen === fen && ply === 0;
  const lastMove = variation ? moveAtPly(variation, ply) : null;

  // Ask for quick evaluations of every position along the selected line.
  const lineFens = useMemo(() => (variation ? variation.moves.map((m) => m.fenAfter) : []), [variation]);
  const { requestPlyEvals } = a;
  useEffect(() => requestPlyEvals(lineFens), [lineFens, requestPlyEvals]);

  // Facts for whatever is on the board right now.
  const hints = useMemo(() => {
    if (atRoot) return lines.length ? { firstMoves: lines.map((l) => l.pv[0]) } : undefined;
    const pe = a.plyEval(displayFen);
    return pe?.best ? { firstMoves: [pe.best] } : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [atRoot, lines, displayFen, a.plyVersion]);
  const facts = useMemo(() => computeFacts(displayFen, hints), [displayFen, hints]);
  const ctx = facts.ctx;

  const rootEval: Evaluation | null = lines[0]?.eval ?? null;
  const extraThreats = useMemo(() => {
    if (!atRoot || !a.threat || !rootEval || !done) return [];
    const f = threatFact(fen, rootEval, a.threat);
    return f ? [f] : [];
  }, [atRoot, a.threat, rootEval, done, fen]);

  const plans = useMemo(() => (atRoot ? findPlans(ctx, lines) : findPlans(ctx, [])), [atRoot, ctx, lines]);

  // Evaluation shown next to the board follows the board.
  const shown = useMemo(() => {
    if (atRoot && !variation) return rootEval ? { e: rootEval, depth: lines[0]?.depth } : null;
    if (ply === 0) return rootEval ? { e: rootEval, depth: lines[0]?.depth } : null;
    const pe = a.plyEval(displayFen);
    return pe ? { e: pe.eval, depth: pe.depth } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [atRoot, variation, ply, rootEval, lines, displayFen, a.plyVersion]);

  const stripEvals = useMemo(() => {
    if (!variation) return [];
    return [rootEval, ...variation.moves.map((m) => a.plyEval(m.fenAfter)?.eval ?? null)];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [variation, rootEval, a.plyVersion]);

  // Legal destinations when trying your own move from the root position.
  const targets = useMemo(() => {
    if (!selected || !atRoot || line) return [];
    return [...new Set(ctx.legal.filter((m) => m.from === selected).map((m) => m.to))];
  }, [selected, atRoot, line, ctx]);

  const trace = useMemo(() => (selected ? traceSquare(ctx, selected) : null), [selected, ctx]);

  const selectLine = useCallback((l: LineRef, startPly = 1) => {
    setLine(l);
    setPly(startPly);
    setAnimKey((k) => k + 1);
    setSelected(null);
    setFocus(null);
  }, []);

  const nav = useCallback(
    (action: NavAction) => {
      if (!variation) return;
      setPly((p) => {
        const next = navigate(variation, p, action);
        if (next !== p) setAnimKey((k) => k + 1);
        return next;
      });
      setFocus(null);
      setSelected(null);
    },
    [variation],
  );

  const openWhy = (l: LineRef) => {
    setPanel("lines");
    selectLine(l, 1);
    setWhy({ kind: "why", line: l, data: explainMove(fen, { pv: l.pv, eval: l.eval, depth: l.depth }) });
  };

  const openWhyNot = (l: LineRef) => {
    setPanel("lines");
    selectLine(l, 1);
    const best = lines[0];
    if (!best) return;
    setWhy({
      kind: "whynot",
      line: l,
      data: explainWhyNot(fen, { pv: best.pv, eval: best.eval, depth: best.depth }, { pv: l.pv, eval: l.eval, depth: l.depth }),
    });
  };

  const tryMove = async (uci: string) => {
    setSelected(null);
    setPanel("lines");
    const placeholder: LineRef = { key: `try-${uci}`, kind: "try", pv: [uci], eval: rootEval ?? { kind: "cp", cp: 0 }, depth: 0 };
    selectLine(placeholder, 1);
    setWhy({ kind: "whynot", line: placeholder, data: null, loading: true });
    const res = await a.analyzeMove(uci);
    if (!res || !res.pv.length) {
      setWhy({ kind: "whynot", line: placeholder, data: null, loading: false });
      return;
    }
    const ref: LineRef = { key: `try-${uci}`, kind: "try", pv: res.pv, eval: res.eval, depth: res.depth };
    setLine((cur) => (cur?.key === ref.key ? ref : cur));
    const best = lines[0];
    if (best && best.pv[0] === uci) {
      setWhy({ kind: "why", line: ref, data: explainMove(fen, { pv: ref.pv, eval: ref.eval, depth: ref.depth }) });
    } else if (best) {
      setWhy({ kind: "whynot", line: ref, data: explainWhyNot(fen, { pv: best.pv, eval: best.eval, depth: best.depth }, { pv: ref.pv, eval: ref.eval, depth: ref.depth }) });
    } else {
      setWhy({ kind: "why", line: ref, data: explainMove(fen, { pv: ref.pv, eval: ref.eval, depth: ref.depth }) });
    }
  };

  const onSquare = (sq: Square) => {
    if (selected && targets.includes(sq)) {
      const m = ctx.legal.find((x) => x.from === selected && x.to === sq);
      if (m) void tryMove(m.lan);
      return;
    }
    setSelected((cur) => (cur === sq ? null : sq));
    setFocus(null);
  };

  const closeLine = () => {
    setLine(null);
    setPly(0);
    setWhy(null);
  };

  // Keyboard: arrows step through the line, Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowRight") nav("next");
      else if (e.key === "ArrowLeft") nav("prev");
      else if (e.key === "Home") nav("first");
      else if (e.key === "End") nav("last");
      else if (e.key === "Escape") {
        setSelected(null);
        setFocus(null);
        setHoverPoint(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  // What to draw on the board, most specific first.
  const marks: Marks = useMemo(() => {
    if (hoverPoint) return hoverPoint;
    if (panel === "compare" && atRoot && lines.length >= 2) {
      const m = emptyMarks();
      const la = lines.find((l) => l.multipv === pair[0]);
      const lb = lines.find((l) => l.multipv === pair[1]);
      if (la?.pv[0]) m.arrows.push({ from: la.pv[0].slice(0, 2) as Square, to: la.pv[0].slice(2, 4) as Square, tone: "opportunity" });
      if (lb?.pv[0]) m.arrows.push({ from: lb.pv[0].slice(0, 2) as Square, to: lb.pv[0].slice(2, 4) as Square, tone: "info" });
      return m;
    }
    if (panel === "plans" && (planHover || planFocus)) {
      const p = plans.find((x) => x.id === (planHover ?? planFocus));
      if (p) return p.marks;
    }
    if (hoverLine && atRoot) {
      const m = emptyMarks();
      const u = hoverLine.pv[0];
      if (u) m.arrows.push({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, tone: "opportunity" });
      return m;
    }
    if (trace) return trace.marks;
    const withExtras = { ...facts, byLens: { ...facts.byLens, threats: [...extraThreats, ...facts.byLens.threats] } };
    const base = marksForLenses(withExtras, lenses, hoverFact ?? focus);
    // Hint at the next move of the line.
    if (variation && ply < variation.moves.length) {
      const nx = variation.moves[ply];
      base.arrows.push({ from: nx.from, to: nx.to, tone: "info", thin: true, dashed: true });
    }
    return base;
  }, [hoverPoint, panel, atRoot, lines, pair, planHover, planFocus, plans, hoverLine, trace, facts, extraThreats, lenses, hoverFact, focus, variation, ply]);

  const toggleLens = (id: LensId) => {
    setFocus(null);
    setSelected(null);
    setLenses((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };
  const cleanBoard = () => {
    if (lenses.length) {
      setSavedLenses(lenses);
      setLenses([]);
    } else setLenses(savedLenses.length ? savedLenses : ["threats"]);
    setFocus(null);
    setSelected(null);
  };

  const context = variation
    ? ply === 0
      ? "Starting position"
      : `After ${lastMove?.color === "w" ? `${lastMove.moveNumber}.` : `${lastMove?.moveNumber}…`}${lastMove?.san} in this line`
    : `${turn === "w" ? "White" : "Black"} to move`;

  const progress = settings.depth ? Math.min(1, (a.snapshot?.depth ?? 0) / settings.depth) : Math.min(1, (a.snapshot?.elapsedMs ?? 0) / (settings.movetimeMs ?? 1));

  const placement = useMemo(() => placementFromFen(displayFen), [displayFen]);
  const displayTurn = displayFen.split(" ")[1] as Color;

  return (
    <main className="studio">
      <section className="stage" aria-label="Board">
        <EvalHeadline
          e={shown?.e ?? null}
          depth={shown?.depth}
          context={context}
          pending={a.status === "error" ? "The engine isn't available, but the board lenses still work." : ply > 0 ? "Checking this position…" : undefined}
        />
        <div className="board-wrap">
          <EvalBar e={shown?.e ?? null} orientation={orientation} pending={!shown} />
          <div className="board-frame">
            <Board
              placement={placement}
              orientation={orientation}
              marks={marks}
              lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
              animate={lastMove ? { from: lastMove.from, to: lastMove.to, key: String(animKey) } : null}
              selected={selected}
              targets={targets}
              onSquareClick={onSquare}
              label={`Chess position, ${displayTurn === "w" ? "White" : "Black"} to move`}
              dimPieces={!!hoverPoint}
            />
          </div>
        </div>
        <div className="board-side">
          <span className={`turn-flag turn-${displayTurn}`}>{displayTurn === "w" ? "White" : "Black"} to move</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onOrientation(other(orientation))}>
            Flip ⇅
          </button>
        </div>
        {trace && (
          <div className="trace" aria-live="polite">
            {trace.lines.map((l, i) => (
              <p key={i} className={i === 0 ? "trace-head" : undefined}>
                {l}
              </p>
            ))}
            {targets.length > 0 && <p className="muted small">Tap a dotted square to try that move and ask the engine about it.</p>}
          </div>
        )}
        <VariationBar
          variation={variation}
          ply={ply}
          onNav={nav}
          evals={stripEvals}
          title={line?.kind === "try" ? "Your move, played out" : line ? `Engine line ${line.rank}` : ""}
          onClose={variation ? closeLine : undefined}
        />
      </section>

      <aside className="rail" aria-label="What to look at">
        <LensPanel
          facts={facts}
          active={lenses}
          onToggle={toggleLens}
          onClean={cleanBoard}
          focus={focus}
          onFocus={(id) => {
            setFocus(id);
            setSelected(null);
          }}
          onHover={setHoverFact}
          extraThreats={extraThreats}
        />
        {!atRoot && <p className="muted small pad">These lenses describe the board as it stands in the line, not the starting position.</p>}
      </aside>

      <section className="desk" aria-label="Engine">
        <div className="engine-bar">
          <div className="engine-status">
            <span className={`dot dot-${a.status}`} aria-hidden />
            <span>
              {a.status === "starting" && "Starting Stockfish…"}
              {a.status === "running" && `Thinking · depth ${a.snapshot?.depth ?? 0}${settings.depth ? ` of ${settings.depth}` : ""}`}
              {a.status === "done" && `Stockfish · depth ${a.snapshot?.depth ?? 0}`}
              {a.status === "stopped" && `Stopped at depth ${a.snapshot?.depth ?? 0}`}
              {a.status === "error" && "Engine unavailable"}
            </span>
            {a.snapshot?.nps ? <span className="muted mono small">{Math.round(a.snapshot.nps / 1000)}k nodes/s</span> : null}
          </div>
          <div className="engine-controls">
            <select className="select select-sm" value={presetIdx} onChange={(e) => setPresetIdx(Number(e.target.value))} aria-label="Search depth or time">
              {SEARCH_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
            <select className="select select-sm" value={multipv} onChange={(e) => setMultipv(Number(e.target.value))} aria-label="Number of candidate lines">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} line{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            {running ? (
              <button className="btn btn-sm" onClick={a.cancel}>
                Stop
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={a.rerun}>
                {a.status === "error" ? "Retry" : "Re-run"}
              </button>
            )}
          </div>
          <div className="progress" aria-hidden>
            <span style={{ width: `${(running ? progress : done ? 1 : 0) * 100}%` }} className={running ? "progress-run" : ""} />
          </div>
        </div>

        {a.status === "error" && (
          <div className="notice notice-error" role="alert">
            <p>
              <b>Stockfish couldn&apos;t run:</b> {a.error}
            </p>
            <p className="small">The lenses on the left still work because they come from the board itself. Try Retry, or a current version of Chrome, Firefox, Safari or Edge.</p>
          </div>
        )}

        <div className="tabs" role="tablist">
          {(
            [
              ["lines", "Best moves"],
              ["compare", "Compare"],
              ["quiz", "Try it first"],
              ["plans", "Plans"],
            ] as [Panel, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={panel === id} className={panel === id ? "tab tab-on" : "tab"} onClick={() => setPanel(id)}>
              {label}
            </button>
          ))}
        </div>

        {panel === "lines" && (
          <LinesPanel
            fen={fen}
            lines={lines}
            running={running}
            selectedKey={line?.key ?? null}
            onSelect={(l) => {
              setWhy(null);
              selectLine(l, 1);
            }}
            onHoverLine={setHoverLine}
            onWhy={openWhy}
            onWhyNot={openWhyNot}
            why={why}
            onCloseWhy={() => setWhy(null)}
            onHoverPoint={setHoverPoint}
            onShowPly={(p) => {
              setPly(p);
              setAnimKey((k) => k + 1);
            }}
          />
        )}
        {panel === "compare" && <ComparePanel fen={fen} lines={lines} orientation={orientation} pair={pair} onPair={setPair} />}
        {panel === "quiz" && <QuizPanel fen={fen} lines={lines} done={done} onWhy={openWhy} onWhyNot={openWhyNot} />}
        {panel === "plans" && <PlansPanel plans={plans} focus={planFocus} onFocus={setPlanFocus} onHover={setPlanHover} />}

        <footer className="desk-foot">
          <button className="linkish" onClick={onEdit}>
            Edit this position
          </button>
          <span className="muted small mono fen-mini" title={fen}>
            {fen}
          </span>
        </footer>
      </section>
    </main>
  );
}

