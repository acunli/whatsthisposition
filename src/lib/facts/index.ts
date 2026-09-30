import { makeCtx, type Ctx } from "./context";
import { activityFacts } from "./activity";
import { controlFacts, controlMarks } from "./control";
import { kingFacts } from "./king";
import { materialFacts } from "./material";
import { pawnFacts } from "./pawns";
import { threatFacts, type EngineHints } from "./threats";
import { emptyMarks, type Fact, type LegendItem, type LensId, type Marks } from "./types";

export * from "./types";
export { makeCtx } from "./context";
export type { EngineHints } from "./threats";

export interface LensMeta {
  id: LensId;
  label: string;
  short: string;
  question: string;
  legend: LegendItem[];
}

export const LENSES: LensMeta[] = [
  {
    id: "threats",
    label: "Threats",
    short: "Threats",
    question: "What can be taken, pinned, forked or checked right now?",
    legend: [
      { tone: "danger", style: "ring", label: "Piece at risk" },
      { tone: "opportunity", style: "arrow", label: "Capture or forcing move" },
      { tone: "idea", style: "arrow", label: "Idea the engine doesn't back" },
      { tone: "info", style: "dot", label: "Safe square" },
    ],
  },
  {
    id: "king",
    label: "King safety",
    short: "Kings",
    question: "How exposed is each king?",
    legend: [
      { tone: "danger", style: "hatch", label: "Attacked square next to a king" },
      { tone: "info", style: "dot", label: "Free square for the king" },
      { tone: "danger", style: "dashed", label: "Missing pawn cover" },
      { tone: "danger", style: "arrow", label: "Attacker" },
    ],
  },
  {
    id: "pawns",
    label: "Pawn structure",
    short: "Pawns",
    question: "Which pawns are strong, and which are targets?",
    legend: [
      { tone: "opportunity", style: "ring", label: "Passed pawn" },
      { tone: "opportunity", style: "dot", label: "Path to promotion" },
      { tone: "danger", style: "ring", label: "Isolated / backward pawn" },
      { tone: "danger", style: "fill", label: "Attacked more than defended" },
    ],
  },
  {
    id: "activity",
    label: "Piece activity",
    short: "Activity",
    question: "Which pieces are working, and which are stuck?",
    legend: [
      { tone: "danger", style: "ring", label: "Restricted piece" },
      { tone: "opportunity", style: "fill", label: "Outpost in use" },
      { tone: "opportunity", style: "dashed", label: "Outpost to aim for" },
      { tone: "info", style: "hatch", label: "Open file" },
    ],
  },
  {
    id: "control",
    label: "Control & pressure",
    short: "Control",
    question: "Who owns which squares, and where is the pressure?",
    legend: [
      { tone: "white", style: "fill", label: "White attacks it more" },
      { tone: "black", style: "fill", label: "Black attacks it more" },
      { tone: "info", style: "hatch", label: "Evenly contested" },
      { tone: "danger", style: "arrow", label: "Pressure on a target" },
    ],
  },
  {
    id: "material",
    label: "Material",
    short: "Material",
    question: "Who has more, and what kind?",
    legend: [{ tone: "info", style: "ring", label: "Piece in an imbalance" }],
  },
];

export interface PositionFacts {
  ctx: Ctx;
  byLens: Record<LensId, Fact[]>;
  /** Marks drawn under a lens regardless of which fact is focused (e.g. the control map). */
  baseMarks: Partial<Record<LensId, Marks>>;
}

export function computeFacts(fen: string, hints?: EngineHints): PositionFacts {
  const ctx = makeCtx(fen);
  const sort = (f: Fact[]) => [...f].sort((a, b) => b.priority - a.priority);
  return {
    ctx,
    byLens: {
      threats: sort(threatFacts(ctx, hints)),
      king: sort(kingFacts(ctx)),
      pawns: sort(pawnFacts(ctx)),
      activity: sort(activityFacts(ctx)),
      control: sort(controlFacts(ctx)),
      material: sort(materialFacts(ctx)),
    },
    baseMarks: { control: controlMarks(ctx.p) },
  };
}

export function marksForLenses(facts: PositionFacts, lenses: LensId[], focused?: string | null): Marks {
  const out = emptyMarks();
  for (const lens of lenses) {
    const base = facts.baseMarks[lens];
    if (base) out.squares.push(...base.squares);
    for (const f of facts.byLens[lens]) {
      if (focused && f.id !== focused) continue;
      out.squares.push(...f.marks.squares);
      out.arrows.push(...f.marks.arrows);
      out.badges.push(...f.marks.badges);
    }
  }
  return out;
}
