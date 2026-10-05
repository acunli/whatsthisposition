"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BoardStage } from "../BoardStage";
import { PeekOrientation } from "../peek/Peek";
import { placementFromFen } from "@/lib/chess/fen";
import { other, type Color, type Square } from "@/lib/chess/types";
import type { EngineLine } from "@/lib/engine/client";
import type { Evaluation } from "@/lib/engine/score";
import { computeFacts, marksForLenses, mergeMarks, type Fact, type LensId, type Marks } from "@/lib/facts";
import { buildAdvice } from "@/lib/facts/advice";
import { threatFact } from "@/lib/facts/engineFacts";
import { explainWhyNot } from "@/lib/facts/explain";
import { boardIdeas } from "@/lib/reason/ideas";
import { buildLedger, labelOf, polarityOf } from "@/lib/facts/ledger";
import { materialSummary } from "@/lib/facts/material";
import { findPlans } from "@/lib/facts/plans";
import { planCard } from "@/lib/plans/cards";
import { buildTour, type Scene } from "@/lib/facts/tour";
import { deepScenes } from "@/lib/deep/scenes";
import { traceSquare } from "@/lib/facts/trace";
import { emptyMarks } from "@/lib/facts/types";
import { buildVariation, fenAtPly, moveAtPly, navigate, type NavAction } from "@/lib/variation";
import { Caption, EvalBar, sideName, type CaptionData } from "./bits";
import { ComparePanel } from "./ComparePanel";
import { LayersPanel } from "./LayersPanel";
import { LedgerPanel } from "./LedgerPanel";
import { LinesPanel, type LineRef, type WhyState } from "./LinesPanel";
import { PlansPanel } from "./PlansPanel";
import { usePlanTimings } from "./usePlanTimings";
import { QuizPanel } from "./QuizPanel";
import { ScanIntro } from "./ScanIntro";
import { Scoreboard } from "./Scoreboard";
import { StoryPanel } from "./StoryPanel";
import { SEARCH_PRESETS, useAnalysis } from "./useAnalysis";
import { VariationBar } from "./VariationBar";

type Tab = "story" | "ledger" | "moves" | "layers" | "plans";
type MovesMode = "lines" | "compare" | "quiz";

interface Props {
  fen: string;
  orientation: Color;
  onOrientation: (c: Color) => void;
  onEdit: () => void;
}

const THREAT_KINDS = ["hanging", "attacked-by-cheaper", "engine-threat", "check", "fork", "skewer", "pin-absolute", "back-rank"];

const factCaption = (f: Fact, label?: string): CaptionData => {
  const pol = polarityOf(f);
  return {
    key: f.id,
    tone: pol === "strength" ? "opportunity" : pol === "weakness" ? "danger" : f.tone,
    tag: pol === "strength" ? "+" : pol === "weakness" ? "−" : "•",
    kind: `${sideName(f.side)} · ${label ?? (pol === "neutral" ? "note" : pol)}`,
    text: f.title,
  };
};

export function AnalysisView({ fen, orientation, onOrientation, onEdit }: Props) {
  const [presetIdx, setPresetIdx] = useState(1);
  const [multipv, setMultipv] = useState(3);
  const settings = SEARCH_PRESETS[presetIdx];
  const a = useAnalysis(fen, settings, multipv);

  const [introDone, setIntroDone] = useState(false);
  const [tab, setTab] = useState<Tab>("story");
  const [movesMode, setMovesMode] = useState<MovesMode>("lines");
  const [lenses, setLenses] = useState<LensId[]>(["threats"]);
  const [savedLenses, setSavedLenses] = useState<LensId[]>(["threats"]);
  const [focus, setFocus] = useState<string | null>(null);
  const [hoverFact, setHoverFact] = useState<Fact | null>(null);
  const [pinned, setPinned] = useState<Fact | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState<Square | null>(null);
  const [line, setLine] = useState<LineRef | null>(null);
  const [ply, setPly] = useState(0);
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
  const atRoot = displayFen === fen;
  const lastMove = variation ? moveAtPly(variation, ply) : null;
  const displayTurn = displayFen.split(" ")[1] as Color;

  const lineFens = useMemo(() => (variation ? variation.moves.map((m) => m.fenAfter) : []), [variation]);
  const { requestPlyEvals } = a;
  useEffect(() => requestPlyEvals(lineFens), [lineFens, requestPlyEvals]);

  // Root facts use engine hints only once the search has settled, so the tour doesn't reshuffle mid-search.
  const rootHints = useMemo(() => (done && lines.length ? { firstMoves: lines.map((l) => l.pv[0]) } : undefined), [done, lines]);
  const rootFacts = useMemo(() => computeFacts(fen, rootHints), [fen, rootHints]);
  const rootEval: Evaluation | null = lines[0]?.eval ?? null;
  const extraThreats = useMemo(() => {
    if (!a.threat || !rootEval || !done) return [];
    const f = threatFact(fen, rootEval, a.threat);
    return f ? [f] : [];
  }, [a.threat, rootEval, done, fen]);
  const rootLedger = useMemo(() => buildLedger(rootFacts, extraThreats), [rootFacts, extraThreats]);

  const displayFacts = useMemo(() => {
    if (atRoot) return rootFacts;
    const pe = a.plyEval(displayFen);
    return computeFacts(displayFen, pe?.best ? { firstMoves: [pe.best] } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [atRoot, rootFacts, displayFen, a.plyVersion]);
  const ledger = useMemo(() => (atRoot ? rootLedger : buildLedger(displayFacts)), [atRoot, rootLedger, displayFacts]);

  const bestFirst = useMemo(() => (lines[0] ? buildVariation(fen, lines[0].pv.slice(0, 1)).moves[0] : undefined), [fen, lines]);
  const advice = useMemo(
    () =>
      buildAdvice(ledger, displayFacts.ctx.p, displayTurn, {
        best: atRoot && done && bestFirst ? { san: bestFirst.san, side: turn } : undefined,
        engineFirstMoves: atRoot && done ? lines.map((l) => l.pv[0]) : undefined,
      }),
    [ledger, displayFacts, displayTurn, atRoot, done, bestFirst, turn, lines],
  );

  // Deep understanding of the best move, started automatically once the search settles.
  const { requestDeep, deepFor } = a;
  useEffect(() => {
    if (!done || !lines[0]) return;
    requestDeep(lines[0], { isBest: true, alternatives: lines.slice(1) });
  }, [done, lines, requestDeep]);
  const bestDeep = done && lines[0] ? deepFor(lines[0].pv[0]) : null;

  // The guided tour: the best move and its ideas first, then the position's findings.
  const scenes: Scene[] = useMemo(() => {
    const base = buildTour(rootLedger, turn, 6);
    if (!done || !lines[0]) return base;
    const dm = bestDeep?.status === "done" ? bestDeep.data : bestDeep?.status === "failed" ? null : "pending";
    return [...deepScenes(fen, lines[0], dm), ...base];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deepVersion signals cache updates
  }, [rootLedger, turn, done, lines, fen, a.deepVersion]);

  const safeScene = Math.min(sceneIdx, Math.max(0, scenes.length - 1));

  const plans = useMemo(() => findPlans(displayFacts.ctx, atRoot ? lines : []), [displayFacts, atRoot, lines]);
  const planCards = useMemo(() => plans.map((pl) => planCard(displayFen, pl)), [plans, displayFen]);
  const bestLineInput = useMemo(() => (lines[0] ? { pv: lines[0].pv, eval: lines[0].eval, depth: lines[0].depth } : undefined), [lines]);
  const { timings: planTimings, threat: planThreat } = usePlanTimings(fen, planCards, bestLineInput, done && atRoot && tab === "plans");
  const material = useMemo(() => materialSummary(displayFacts.ctx.p), [displayFacts]);

  const shown = useMemo(() => {
    if (atRoot) return rootEval ? { e: rootEval, depth: lines[0]?.depth } : null;
    const pe = a.plyEval(displayFen);
    return pe ? { e: pe.eval, depth: pe.depth } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [atRoot, rootEval, lines, displayFen, a.plyVersion]);

  const stripEvals = useMemo(() => {
    if (!variation) return [];
    return [rootEval, ...variation.moves.map((m) => a.plyEval(m.fenAfter)?.eval ?? null)];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plyVersion signals cache updates
  }, [variation, rootEval, a.plyVersion]);

  const targets = useMemo(() => {
    if (!selected || !atRoot || line) return [];
    return [...new Set(displayFacts.ctx.legal.filter((m) => m.from === selected).map((m) => m.to))];
  }, [selected, atRoot, line, displayFacts]);
  const trace = useMemo(() => (selected ? traceSquare(displayFacts.ctx, selected) : null), [selected, displayFacts]);

  const selectLine = useCallback((l: LineRef, startPly = 1) => {
    setLine(l);
    setPly(startPly);
    setAnimKey((k) => k + 1);
    setSelected(null);
    setFocus(null);
    setPinned(null);
    setPlaying(false);
  }, []);

  const nav = useCallback(
    (action: NavAction) => {
      if (!variation) return;
      setPly((p) => {
        const next = navigate(variation, p, action);
        if (next !== p) setAnimKey((k) => k + 1);
        return next;
      });
      setSelected(null);
    },
    [variation],
  );

  const openWhy = (l: LineRef) => {
    setTab("moves");
    setMovesMode("lines");
    selectLine(l, 1);
    setWhy({ kind: "why", line: l });
    requestDeep(l, { isBest: l.pv[0] === lines[0]?.pv[0], alternatives: lines.filter((x) => x.pv[0] !== l.pv[0]), bestLine: lines[0] });
  };

  const openWhyNot = (l: LineRef) => {
    setTab("moves");
    setMovesMode("lines");
    selectLine(l, 1);
    const best = lines[0];
    if (!best) return;
    setWhy({ kind: "whynot", line: l, data: explainWhyNot(fen, { pv: best.pv, eval: best.eval, depth: best.depth }, { pv: l.pv, eval: l.eval, depth: l.depth }) });
  };

  const tryMove = async (uci: string) => {
    setSelected(null);
    setTab("moves");
    setMovesMode("lines");
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
    if (best && best.pv[0] !== uci) {
      setWhy({ kind: "whynot", line: ref, data: explainWhyNot(fen, { pv: best.pv, eval: best.eval, depth: best.depth }, { pv: ref.pv, eval: ref.eval, depth: ref.depth }) });
    } else {
      setWhy({ kind: "why", line: ref });
      requestDeep(ref, { isBest: true, alternatives: lines.filter((x) => x.pv[0] !== uci) });
    }
  };

  const onSquare = (sq: Square) => {
    if (selected && targets.includes(sq)) {
      const m = displayFacts.ctx.legal.find((x) => x.from === selected && x.to === sq);
      if (m) void tryMove(m.lan);
      return;
    }
    setPlaying(false);
    setSelected((cur) => (cur === sq ? null : sq));
  };

  /** Play a line from the analysed position; an empty pv means "the line of the open explanation". */
  const playLine = (pv: string[], toPly: number) => {
    if (!pv.length) {
      const l = why?.line;
      if (l && line?.key !== l.key) selectLine(l, toPly);
      else {
        setPly(toPly);
        setAnimKey((k) => k + 1);
      }
      return;
    }
    const ref: LineRef = { key: `side-${pv.join("")}`, kind: "side", pv, eval: rootEval ?? { kind: "cp", cp: 0 }, depth: 0 };
    selectLine(ref, toPly);
  };

  const closeLine = () => {
    setLine(null);
    setPly(0);
    setWhy(null);
  };

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
        setPinned(null);
        setHoverPoint(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  // One spotlight decides what the board shows, most specific first.
  const spot = useMemo((): { marks: Marks; key: string; caption: CaptionData | null } => {
    if (hoverPoint) return { marks: hoverPoint, key: "point", caption: null };
    if (hoverFact) return { marks: hoverFact.marks, key: `h-${hoverFact.id}`, caption: factCaption(hoverFact) };
    if (hoverLine && atRoot) {
      const m = emptyMarks();
      const u = hoverLine.pv[0];
      if (u) m.arrows.push({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, tone: "opportunity" });
      return { marks: m, key: `line-${u}`, caption: null };
    }
    if (trace) {
      return {
        marks: trace.marks,
        key: `trace-${trace.sq}`,
        caption: { key: `trace-${trace.sq}`, tone: "white", tag: "◎", kind: "Tracing", text: trace.lines.join(" ") },
      };
    }
    const nextHint = (m: Marks) => {
      if (variation && ply < variation.moves.length) {
        const nx = variation.moves[ply];
        m.arrows.push({ from: nx.from, to: nx.to, tone: "info", thin: true, dashed: true });
      }
      return m;
    };
    const moveCaption = (): CaptionData | null => {
      if (!lastMove) return null;
      const num = lastMove.color === "w" ? `${lastMove.moveNumber}.` : `${lastMove.moveNumber}…`;
      // The first move of a line with a finished deep analysis gets the deep headline, not a one-move guess.
      const deep = ply === 1 && lastMove.fenBefore === fen ? deepFor(lastMove.uci) : null;
      if (deep?.status === "done") {
        const d = deep.data;
        return { key: `mv-${ply}-${line?.key}-deep`, tone: "opportunity", tag: d.classification.symbol || `${ply}`, kind: `${d.classification.label} · ${num}${lastMove.san}`, text: d.headline };
      }
      const ideas = boardIdeas(lastMove, { after: variation ? variation.moves.slice(ply) : [], evalAfter: 0 });
      const best = ideas.find((p) => p.tone !== "danger") ?? ideas[0];
      return {
        key: `mv-${ply}-${line?.key}`,
        tone: best?.tone === "info" ? "info" : (best?.tone ?? "info"),
        tag: `${ply}`,
        kind: `${sideName(lastMove.color)} plays ${num}${lastMove.san}`,
        text: best?.text ?? "A quiet move: its point comes later in the line.",
      };
    };
    if (tab === "story" && atRoot) {
      const s = scenes[safeScene];
      if (s) {
        const cap = factCaption(s.fact, s.polarity);
        return { marks: s.fact.marks, key: `scene-${s.id}`, caption: s.kicker ? { ...cap, kind: s.kicker, tag: s.id === "deep-move" ? "★" : cap.tag } : cap };
      }
    }
    if (tab === "ledger" && pinned) return { marks: pinned.marks, key: `pin-${pinned.id}`, caption: factCaption(pinned, labelOf(pinned, displayFacts)) };
    if (tab === "layers") {
      const all = { ...displayFacts, byLens: { ...displayFacts.byLens, threats: atRoot ? [...extraThreats, ...displayFacts.byLens.threats] : displayFacts.byLens.threats } };
      const m = marksForLenses(all, lenses, focus);
      const f = focus ? Object.values(all.byLens).flat().find((x) => x.id === focus) : null;
      const n = lenses.reduce((s2, l) => s2 + all.byLens[l].length, 0);
      return {
        marks: nextHint(m),
        key: `layers-${lenses.join("")}-${focus}-${displayFen}`,
        caption: f
          ? factCaption(f)
          : lenses.length
            ? { key: `l-${lenses.join("")}`, tone: "info", tag: String(n), kind: `${lenses.length} layer${lenses.length > 1 ? "s" : ""} on`, text: "Hover a finding to isolate it on the board, or tap a piece to trace it." }
            : moveCaption(),
      };
    }
    if (tab === "plans" && (planHover || planFocus)) {
      const c = planCards.find((x) => x.id === (planHover ?? planFocus));
      if (c) {
        const t = planTimings[c.id];
        const timing = t && t !== "pending" ? t : null;
        const m = mergeMarks(c.marks, timing?.marks ?? emptyMarks(), ...c.benefits.slice(0, 1).map((b) => b.marks));
        const verdict = timing ? { now: "good now", prepare: "prepare first", "not-now": "not now", later: "later" }[timing.verdict] : "checking";
        return {
          marks: m,
          key: `plan-${c.id}-${timing?.verdict ?? ""}`,
          caption: {
            key: c.id,
            tone: timing?.verdict === "not-now" ? "danger" : timing?.verdict === "now" ? "opportunity" : "idea",
            tag: timing?.verdict === "now" ? "✓" : timing?.verdict === "not-now" ? "✕" : "?",
            kind: `${sideName(c.side)} · ${c.style} plan · ${verdict}`,
            text: timing?.text ?? c.title,
          },
        };
      }
    }
    if (tab === "moves" && movesMode === "compare" && atRoot && lines.length >= 2) {
      const m = emptyMarks();
      const la = lines.find((l) => l.multipv === pair[0]);
      const lb = lines.find((l) => l.multipv === pair[1]);
      if (la?.pv[0]) m.arrows.push({ from: la.pv[0].slice(0, 2) as Square, to: la.pv[0].slice(2, 4) as Square, tone: "opportunity" });
      if (lb?.pv[0]) m.arrows.push({ from: lb.pv[0].slice(0, 2) as Square, to: lb.pv[0].slice(2, 4) as Square, tone: "white" });
      return { marks: m, key: `cmp-${pair.join("")}`, caption: null };
    }
    return { marks: nextHint(emptyMarks()), key: `plain-${ply}`, caption: moveCaption() };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deepVersion signals deep-cache updates
  }, [hoverPoint, hoverFact, hoverLine, atRoot, trace, variation, ply, lastMove, line, tab, scenes, safeScene, pinned, displayFacts, extraThreats, lenses, focus, displayFen, planHover, planFocus, planCards, planTimings, movesMode, lines, pair, fen, deepFor, a.deepVersion]);

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

  const context =
    variation && ply > 0 && lastMove
      ? `After ${lastMove.color === "w" ? `${lastMove.moveNumber}.` : `${lastMove.moveNumber}…`}${lastMove.san} · ${sideName(displayTurn)} to move`
      : `${sideName(turn)} to move · move ${fen.split(" ")[5]}`;
  const progress = settings.depth ? Math.min(1, (a.snapshot?.depth ?? 0) / settings.depth) : Math.min(1, (a.snapshot?.elapsedMs ?? 0) / (settings.movetimeMs ?? 1));
  // Story chapters can preview a position inside a line (e.g. "if the pawn is taken…").
  const storyScene = tab === "story" && atRoot ? scenes[safeScene] : undefined;
  const preview = useMemo(() => {
    if (!storyScene?.preview) return null;
    const pv = buildVariation(fen, storyScene.preview.pv, 24);
    return { fen: fenAtPly(pv, storyScene.preview.ply), move: moveAtPly(pv, storyScene.preview.ply) };
  }, [storyScene, fen]);
  const boardFen = preview?.fen ?? displayFen;
  const boardMove = preview ? preview.move : lastMove;
  const placement = useMemo(() => placementFromFen(boardFen), [boardFen]);
  const rootPlacement = useMemo(() => placementFromFen(fen), [fen]);
  const threatCount = [...rootLedger.w.weaknesses, ...rootLedger.b.weaknesses].filter((e) => THREAT_KINDS.includes(e.fact.kind)).length;

  const TABS: [Tab, string, number | null][] = [
    ["story", "Story", scenes.length],
    ["ledger", "Strengths & weaknesses", null],
    ["moves", "Moves", lines.length || null],
    ["layers", "Layers", null],
    ["plans", "Plans", plans.length || null],
  ];

  // Line previews (hover a move in an explanation) use the board's orientation.
  return (
    <PeekOrientation.Provider value={orientation}>
      {!introDone && (
        <ScanIntro placement={rootPlacement} orientation={orientation} ledger={rootLedger} threats={threatCount} depth={a.snapshot?.depth ?? 0} onDone={() => setIntroDone(true)} />
      )}
      <main className="arena">
        <Scoreboard
          ledger={ledger}
          material={material}
          turn={displayTurn}
          orientation={orientation}
          evaluation={shown?.e ?? null}
          depth={shown?.depth}
          context={context}
          status={a.status}
          snapshot={a.snapshot}
          error={a.error}
          presetIdx={presetIdx}
          onPreset={setPresetIdx}
          multipv={multipv}
          onMultipv={setMultipv}
          onStop={a.cancel}
          onRerun={a.rerun}
          progress={running ? progress : done ? 1 : 0}
        />

        <section className="board-col" aria-label="Board">
          <div className="board-bar">
            <span className="board-title">{context}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => onOrientation(other(orientation))}>
              Flip ⇅
            </button>
          </div>
          <div className="board-wrap">
            <EvalBar e={shown?.e ?? null} orientation={orientation} />
            <BoardStage
              placement={placement}
              orientation={orientation}
              marks={spot.marks}
              revealKey={`${spot.key}-${animKey}`}
              lastMove={boardMove ? { from: boardMove.from, to: boardMove.to } : null}
              animate={boardMove ? { from: boardMove.from, to: boardMove.to, key: `${animKey}-${storyScene?.id ?? ""}` } : null}
              selected={selected}
              targets={targets}
              onSquareClick={onSquare}
              label={`Chess position, ${sideName(displayTurn)} to move`}
              dimPieces={!!hoverPoint}
            />
          </div>
          <Caption c={spot.caption} />
          {targets.length > 0 && (
            <p className="hint" style={{ textAlign: "center" }}>
              Tap a dotted square to try that move and ask the engine about it.
            </p>
          )}
          {variation && (
            <VariationBar
              variation={variation}
              ply={ply}
              onNav={nav}
              evals={stripEvals}
              title={line?.kind === "try" ? "Your move, played out" : line?.kind === "side" ? "Side line" : `Engine line ${line?.rank ?? ""}`}
              onClose={closeLine}
            />
          )}
        </section>

        <aside className="desk" aria-label="Analysis">
          <div className="tabs" role="tablist">
            {TABS.map(([id, label, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "tab tab-on" : "tab"}
                onClick={() => {
                  setTab(id);
                  setHoverFact(null);
                }}
              >
                {label}
                {count ? <span className="count">{count}</span> : null}
              </button>
            ))}
          </div>

          {a.status === "error" && (
            <div className="notice notice-error" role="alert">
              <p>
                <b>Stockfish couldn&apos;t run.</b> {a.error}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                The story, ledger, layers and plans still work: they come from the board itself. Try Re-run, or a current browser.
              </p>
            </div>
          )}

          {tab === "story" && (
            <StoryPanel
              scenes={scenes}
              index={safeScene}
              onIndex={(i) => {
                setSceneIdx(i);
                setSelected(null);
              }}
              playing={playing && introDone && bestDeep?.status !== "pending"}
              onPlaying={setPlaying}
              offRoot={!atRoot}
              onBackToRoot={closeLine}
            />
          )}

          {tab === "ledger" && (
            <LedgerPanel
              ledger={ledger}
              advice={advice}
              selected={pinned?.id ?? null}
              onHover={setHoverFact}
              onSelect={(f) => {
                setPinned(f);
                setSelected(null);
              }}
              turn={displayTurn}
            />
          )}

          {tab === "moves" && (
            <div className="desk-body" style={{ display: "grid", gap: 10 }}>
              <div className="tabs" role="tablist" aria-label="Moves view">
                {(
                  [
                    ["lines", "Best lines"],
                    ["compare", "Compare"],
                    ["quiz", "Try it first"],
                  ] as [MovesMode, string][]
                ).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={movesMode === id} className={movesMode === id ? "tab tab-on" : "tab"} onClick={() => setMovesMode(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {movesMode === "lines" && (
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
                  deepFor={deepFor}
                  onPlay={playLine}
                  onShowPly={(p) => {
                    setPly(p);
                    setAnimKey((k) => k + 1);
                  }}
                />
              )}
              {movesMode === "compare" && <ComparePanel fen={fen} lines={lines} orientation={orientation} pair={pair} onPair={setPair} />}
              {movesMode === "quiz" && <QuizPanel fen={fen} lines={lines} done={done} onWhy={openWhy} onWhyNot={openWhyNot} />}
            </div>
          )}

          {tab === "layers" && (
            <LayersPanel
              facts={displayFacts}
              active={lenses}
              onToggle={toggleLens}
              onClean={cleanBoard}
              focus={focus}
              onFocus={(id) => {
                setFocus(id);
                setSelected(null);
              }}
              onHover={setHoverFact}
              extraThreats={atRoot ? extraThreats : []}
            />
          )}

          {tab === "plans" && (
            <div className="desk-body">
              <PlansPanel
                cards={planCards}
                timings={planTimings}
                turn={turn}
                threat={atRoot ? planThreat : null}
                bestSan={bestFirst?.san ?? null}
                focus={planFocus}
                onFocus={setPlanFocus}
                onHover={setPlanHover}
                onHoverPoint={setHoverPoint}
                onShow={(pv) => playLine(pv, 1)}
              />
            </div>
          )}

          <footer className="desk-foot">
            <button className="linkish" onClick={onEdit}>
              Edit this position
            </button>
            <span className="fen-mini" title={fen}>
              {fen}
            </span>
          </footer>
        </aside>
      </main>
    </PeekOrientation.Provider>
  );
}
