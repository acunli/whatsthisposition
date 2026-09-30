/**
 * Story chapters about the best move, built from the deep analysis. The move comes
 * first; then what happens if its offer is taken, the threat, what it quietly does,
 * and a key moment from the line. Each chapter can preview a position inside a line.
 */
import type { Color } from "../chess/types";
import type { Scene } from "../facts/tour";
import { emptyMarks, type Fact, type Marks } from "../facts/types";
import { buildVariation } from "../variation";
import type { DeepMove, LineInput } from "./deep";

function fact(id: string, side: Color, title: string, marks: Marks, extra: Partial<Fact> = {}): Fact {
  return {
    id,
    lens: "threats",
    kind: "deep",
    side,
    tone: "opportunity",
    anchor: marks.arrows[0]?.to ?? marks.squares[0]?.sq ?? "e4",
    title,
    evidence: "engine",
    polarity: "strength",
    marks,
    priority: 100,
    ...extra,
  };
}

export function deepScenes(fen: string, best: LineInput, deep: DeepMove | "pending" | null): Scene[] {
  const m = buildVariation(fen, best.pv.slice(0, 1)).moves[0];
  if (!m) return [];
  const side = m.color;
  const arrow = emptyMarks();
  arrow.arrows.push({ from: m.from, to: m.to, tone: "opportunity" });

  if (!deep || deep === "pending") {
    return [
      {
        id: "deep-move",
        side,
        polarity: "strength",
        label: `Best move: ${m.san}`,
        kicker: "The move · looking deeper",
        fact: fact("deep-move", side, `Stockfish's choice is ${m.san}. Now testing the side lines to understand why…`, arrow),
      },
    ];
  }

  const d = deep;
  const scenes: Scene[] = [];
  const moveMarks: Marks = { ...emptyMarks(), arrows: [...arrow.arrows] };
  scenes.push({
    id: "deep-move",
    side,
    polarity: "strength",
    label: `${d.label}${d.classification.symbol}`,
    kicker: `${d.classification.label} · the move`,
    fact: fact("deep-move", side, d.headline, moveMarks, { detail: d.comparison?.text }),
  });

  for (const o of d.offers.filter((x) => x.poisoned)) {
    scenes.push({
      id: `deep-offer-${o.uci}`,
      side,
      polarity: "strength",
      label: `What if ${o.san}?`,
      kicker: o.existing ? "Looks loose, isn't" : "Poisoned: if it's taken",
      preview: { pv: [d.uci, ...o.pv], ply: o.showPly },
      fact: fact(`deep-offer-${o.uci}`, side, o.text, o.showMarks),
    });
  }

  if (d.threat) {
    scenes.push({
      id: "deep-threat",
      side,
      polarity: "strength",
      label: `The threat: ${d.threat.san}`,
      kicker: "What it threatens",
      preview: { pv: [d.uci], ply: 1 },
      fact: fact("deep-threat", side, d.threat.text, d.threat.marks),
    });
  }

  const quiet = d.points.filter((p) => !d.headline.includes(p.text)).slice(0, 2);
  quiet.forEach((p, i) => {
    scenes.push({
      id: `deep-does-${i}`,
      side,
      polarity: p.tone === "danger" ? "weakness" : "strength",
      label: `What ${m.san} does`,
      kicker: p.evidence === "engine" ? "The idea" : "The idea · board fact",
      preview: { pv: [d.uci], ply: 1 },
      fact: fact(`deep-does-${i}`, side, p.text, p.marks, { evidence: p.evidence, tone: p.tone }),
    });
  });

  const moment = d.moments.find((x) => x.color === side && x.ply > 1);
  if (moment) {
    scenes.push({
      id: `deep-moment-${moment.ply}`,
      side,
      polarity: "strength",
      label: `In the line: ${moment.label}`,
      kicker: "Where it leads",
      preview: { pv: d.pv, ply: moment.ply },
      fact: fact(`deep-moment-${moment.ply}`, side, `${moment.text} ${d.outcome}`, moment.marks),
    });
  }
  return scenes;
}
