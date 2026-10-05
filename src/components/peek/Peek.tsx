"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BoardStage } from "../BoardStage";
import { placementFromFen } from "@/lib/chess/fen";
import type { Color } from "@/lib/chess/types";
import type { PeekLine } from "@/lib/facts/types";
import { buildVariation } from "@/lib/variation";

/** The orientation the surrounding board uses, so the preview matches it. */
export const PeekOrientation = createContext<Color>("w");

const STEP_MS = 1100;
const HOLD_MS = 1800;
const MAX_PLIES = 10;

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/** A small board that plays a line, move by move, and loops. */
function PeekBoard({ line, anchor, onEnter, onLeave }: { line: PeekLine; anchor: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const orientation = useContext(PeekOrientation);
  const v = useMemo(() => buildVariation(line.fen, line.pv, MAX_PLIES), [line]);
  const n = v.moves.length;
  const [ply, setPly] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => setPly((p) => (p >= n ? 0 : p + 1)), ply === 0 ? 700 : ply >= n ? HOLD_MS : reduced ? STEP_MS * 1.4 : STEP_MS);
    return () => clearTimeout(t);
  }, [ply, n, reduced]);
  const fen = ply === 0 ? line.fen : v.moves[ply - 1].fenAfter;
  const last = ply > 0 ? v.moves[ply - 1] : null;
  const placement = useMemo(() => placementFromFen(fen), [fen]);

  // Place it below the words if there's room, otherwise above; keep it on screen.
  const W = 272;
  const H = 330;
  const below = anchor.bottom + H + 12 < window.innerHeight;
  const top = below ? anchor.bottom + 8 : Math.max(8, anchor.top - H - 8);
  const left = Math.min(window.innerWidth - W - 8, Math.max(8, anchor.left + anchor.width / 2 - W / 2));

  return (
    <div className="peek-pop" style={{ top, left, width: W }} role="dialog" aria-label="How the line plays out" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <BoardStage
        placement={placement}
        orientation={orientation}
        lastMove={last ? { from: last.from, to: last.to } : null}
        animate={last && !reduced ? { from: last.from, to: last.to, key: `${ply}` } : null}
        marks={
          ply < n
            ? { squares: [], badges: [], arrows: [{ from: v.moves[ply].from, to: v.moves[ply].to, tone: "info", thin: true, dashed: true }] }
            : undefined
        }
        coordinates={false}
        label="Preview of the line"
      />
      <ol className="peek-moves">
        {v.moves.map((m, i) => (
          <li key={i}>
            <button className={i + 1 === ply ? "peek-mv peek-mv-on" : "peek-mv"} onClick={() => setPly(i + 1)}>
              {m.color === "w" ? `${m.moveNumber}.` : i === 0 ? `${m.moveNumber}…` : ""}
              {m.san}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Wraps the words of an explanation that name a line. Hovering (or tapping) them
 * opens a small board playing the line. Without a line it renders the text plainly.
 */
export function Peek({ line, children }: { line?: PeekLine | null; children: ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const valid = !!line && line.pv.length > 0;

  const open = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current && setAnchor(ref.current.getBoundingClientRect()), 180);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(null), 160);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [anchor]);

  if (!valid) return <>{children}</>;
  return (
    <>
      <span
        ref={ref}
        className={anchor ? "peek peek-on" : "peek"}
        tabIndex={0}
        role="button"
        aria-describedby={anchor ? id : undefined}
        aria-label={typeof children === "string" ? `${children} (show how it plays out)` : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.stopPropagation();
          if (anchor) setAnchor(null);
          else if (ref.current) setAnchor(ref.current.getBoundingClientRect());
        }}
      >
        {children}
      </span>
      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div id={id}>
            <PeekBoard line={line!} anchor={anchor} onEnter={() => timer.current && clearTimeout(timer.current)} onLeave={close} />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A sentence with its lines: each line's `label` part becomes hoverable. A single line
 * without a label (or whose label isn't in the text) makes the whole sentence hoverable.
 */
export function PeekText({ text, line, lines }: { text: string; line?: PeekLine | null; lines?: PeekLine[] }) {
  const all = [line, ...(lines ?? [])].filter((l): l is PeekLine => !!l && l.pv.length > 0);
  if (!all.length) return <>{text}</>;
  // Non-overlapping label spans, in text order.
  const spans: { at: number; end: number; line: PeekLine }[] = [];
  for (const l of all) {
    if (!l.label) continue;
    let from = 0;
    let at = -1;
    while ((at = text.indexOf(l.label, from)) >= 0 && spans.some((s) => at < s.end && at + l.label!.length > s.at)) from = at + 1;
    if (at >= 0) spans.push({ at, end: at + l.label.length, line: l });
  }
  if (!spans.length) return all.length === 1 ? <Peek line={all[0]}>{text}</Peek> : <>{text}</>;
  spans.sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let pos = 0;
  spans.forEach((s, i) => {
    if (s.at > pos) out.push(text.slice(pos, s.at));
    out.push(
      <Peek key={i} line={s.line}>
        {text.slice(s.at, s.end)}
      </Peek>,
    );
    pos = s.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}
