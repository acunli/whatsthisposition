import { makeCtx, type Ctx } from "./context";
import { activityFacts } from "./activity";
import { controlFacts, controlMarks } from "./control";
import { kingFacts } from "./king";
import { materialFacts } from "./material";
import { pawnFacts } from "./pawns";
import { threatFacts, type EngineHints } from "./threats";
import { structureFacts } from "./structure";
import { spaceFacts } from "./space";
import { tacticFacts } from "./tactics";
import { pieceFacts } from "./pieces";
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
      { tone: "danger", style: "pulse", label: "Piece at risk" },
      { tone: "opportunity", style: "arrow", label: "Capture or forcing move" },
      { tone: "idea", style: "arrow", label: "Idea the engine doesn't back" },
      { tone: "danger", style: "ring", label: "Piece behind a pin or skewer" },
    ],
  },
  {
    id: "king",
    label: "King safety",
    short: "Kings",
    question: "How exposed is each king?",
    legend: [
      { tone: "danger", style: "flood", label: "Heat around the king" },
      { tone: "info", style: "dot", label: "Free square for the king" },
      { tone: "danger", style: "dashed", label: "Missing pawn cover" },
      { tone: "danger", style: "arrow", label: "Attacker" },
    ],
  },
  {
    id: "pawns",
    label: "Pawn structure",
    short: "Pawns",
    question: "Which pawns are strong, which are targets, and where are the holes?",
    legend: [
      { tone: "opportunity", style: "flood", label: "Passed pawn's runway" },
      { tone: "danger", style: "pit", label: "Hole: no pawn can cover it" },
      { tone: "danger", style: "ring", label: "Weak pawn or chain base" },
      { tone: "danger", style: "pulse", label: "Attacked more than defended" },
    ],
  },
  {
    id: "activity",
    label: "Pieces",
    short: "Pieces",
    question: "Which pieces dominate, and which are stuck?",
    legend: [
      { tone: "white", style: "flood", label: "Squares a piece dominates" },
      { tone: "opportunity", style: "flood", label: "Outpost" },
      { tone: "danger", style: "pulse", label: "Worst / stuck piece" },
      { tone: "opportunity", style: "hatch", label: "Open file or 7th rank" },
    ],
  },
  {
    id: "control",
    label: "Space & control",
    short: "Control",
    question: "Who owns which squares, and where is the pressure?",
    legend: [
      { tone: "white", style: "flood", label: "White controls it" },
      { tone: "black", style: "flood", label: "Black controls it" },
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
  const extra = [...tacticFacts(ctx), ...structureFacts(ctx), ...spaceFacts(ctx), ...pieceFacts(ctx)];
  const of = (lens: LensId) => extra.filter((f) => f.lens === lens);
  return {
    ctx,
    byLens: {
      threats: sort([...threatFacts(ctx, hints), ...of("threats")]),
      king: sort([...kingFacts(ctx), ...of("king")]),
      pawns: sort([...pawnFacts(ctx), ...of("pawns")]),
      activity: sort([...activityFacts(ctx), ...of("activity")]),
      control: sort([...controlFacts(ctx), ...of("control")]),
      material: sort([...materialFacts(ctx), ...of("material")]),
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
      out.links!.push(...(f.marks.links ?? []));
      out.icons!.push(...(f.marks.icons ?? []));
      out.bands!.push(...(f.marks.bands ?? []));
    }
  }
  return out;
}
