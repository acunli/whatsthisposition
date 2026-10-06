"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardStage } from "../BoardStage";
import { placementFromFen } from "@/lib/chess/fen";
import { computeFacts, mergeMarks, type Marks } from "@/lib/facts";
import { makeCtx } from "@/lib/facts/context";
import { dominanceMarks } from "@/lib/facts/pieces";
import { emptyMarks } from "@/lib/facts/types";

interface Concept {
  title: string;
  text: string;
  tone: string;
  fen: string;
  marks: (fen: string) => Marks;
}

const byKind = (fen: string, ...kinds: string[]) => {
  const facts = computeFacts(fen);
  const all = Object.values(facts.byLens).flat();
  const top = (k: string) => all.filter((f) => f.kind === k).sort((a, b) => b.priority - a.priority)[0];
  return mergeMarks(...kinds.map((k) => top(k)?.marks ?? emptyMarks()));
};

const CONCEPTS: Concept[] = [
  {
    title: "Threats",
    text: "Pieces under attack flash red. Forks and skewers draw their lines.",
    tone: "t-danger",
    fen: "r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1",
    marks: (f) => byKind(f, "fork"),
  },
  {
    title: "Domination",
    text: "Every square a piece controls floods in its side's colour.",
    tone: "t-white",
    fen: "r4rk1/pp3ppp/2p5/3N4/8/8/PPP2PPP/R4RK1 w - - 0 1",
    marks: (f) => dominanceMarks(makeCtx(f), "d5"),
  },
  {
    title: "Passed pawns",
    text: "The runway to promotion lights up, square by square.",
    tone: "t-opportunity",
    fen: "8/8/1k6/8/3P4/8/5K2/8 w - - 0 1",
    marks: (f) => byKind(f, "passed"),
  },
  {
    title: "Holes",
    text: "Squares no pawn can ever defend again open up as pits.",
    tone: "t-danger",
    fen: "r1bqkb1r/pp3ppp/2np1n2/4p3/4P3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 8",
    marks: (f) => byKind(f, "hole"),
  },
  {
    title: "Pawn chains",
    text: "Chains link up, and the base, the point to strike, is targeted.",
    tone: "t-idea",
    fen: "4k3/pp6/2p5/3pP3/3P4/2P5/PP6/4K3 w - - 0 1",
    marks: (f) => byKind(f, "pawn-chain"),
  },
  {
    title: "King danger",
    text: "The squares around an exposed king heat up with every attacker.",
    tone: "t-danger",
    fen: "r4rk1/ppp2p1p/6pQ/6N1/8/8/PPP2PPP/R4RK1 w - - 0 1",
    marks: (f) => byKind(f, "king-danger"),
  },
  {
    title: "Open files",
    text: "Files without pawns become highways, and linked rooks pulse along them.",
    tone: "t-opportunity",
    fen: "6k1/5ppp/8/8/8/8/5PPP/2RR2K1 w - - 0 1",
    marks: (f) => byKind(f, "open-file", "connected-rooks"),
  },
  {
    title: "Space",
    text: "Territory behind each side's pawns fills in: who has room to breathe?",
    tone: "t-black",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/3P4/2P1P3/2N5/PP3PPP/R1BQKBNR b KQ - 0 6",
    marks: (f) => byKind(f, "space"),
  },
];

function Tile({ c }: { c: Concept }) {
  const ref = useRef<HTMLElement>(null);
  const [key, setKey] = useState(0);
  const [seen, setSeen] = useState(false);
  const placement = useMemo(() => placementFromFen(c.fen), [c.fen]);
  const marks = useMemo(() => c.marks(c.fen), [c]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          setKey((k) => k + 1);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <article ref={ref} className={`concept ${c.tone}`} onMouseEnter={() => setKey((k) => k + 1)}>
      <BoardStage placement={placement} orientation="w" marks={seen ? marks : undefined} revealKey={key} coordinates={false} label={`${c.title} example`} />
      <h3>{c.title}</h3>
      <p>{c.text}</p>
    </article>
  );
}

export function Concepts() {
  return (
    <div className="concepts">
      {CONCEPTS.map((c) => (
        <Tile key={c.title} c={c} />
      ))}
    </div>
  );
}
