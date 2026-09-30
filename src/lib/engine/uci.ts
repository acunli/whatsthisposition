/** Parsing of UCI engine output lines. Pure and engine-agnostic. */
import type { RawScore } from "./score";

export interface InfoLine {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: RawScore;
  /** Set when the score is only a bound; such lines are not used as final results. */
  bound?: "lower" | "upper";
  nodes?: number;
  nps?: number;
  timeMs?: number;
  pv: string[];
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith("info ")) return null;
  const t = line.trim().split(/\s+/);
  let depth: number | undefined;
  let score: RawScore | undefined;
  const out: Partial<InfoLine> = { multipv: 1, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case "depth":
        depth = Number(t[++i]);
        break;
      case "seldepth":
        out.seldepth = Number(t[++i]);
        break;
      case "multipv":
        out.multipv = Number(t[++i]);
        break;
      case "nodes":
        out.nodes = Number(t[++i]);
        break;
      case "nps":
        out.nps = Number(t[++i]);
        break;
      case "time":
        out.timeMs = Number(t[++i]);
        break;
      case "score": {
        const kind = t[++i];
        const value = Number(t[++i]);
        if ((kind === "cp" || kind === "mate") && Number.isFinite(value)) score = { kind, value };
        if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") {
          out.bound = t[++i] === "lowerbound" ? "lower" : "upper";
        }
        break;
      }
      case "pv": {
        const pv: string[] = [];
        while (i + 1 < t.length && UCI_MOVE.test(t[i + 1])) pv.push(t[++i]);
        out.pv = pv;
        break;
      }
      case "string":
        // free text: ignore the rest of the line
        i = t.length;
        break;
    }
  }
  if (depth === undefined || !score) return null;
  return { ...(out as InfoLine), depth, score };
}

export function parseBestMove(line: string): { best: string | null; ponder?: string } | null {
  if (!line.startsWith("bestmove")) return null;
  const t = line.trim().split(/\s+/);
  const best = t[1] && UCI_MOVE.test(t[1]) ? t[1] : null; // "(none)" when there is no legal move
  const ponder = t[2] === "ponder" && t[3] && UCI_MOVE.test(t[3]) ? t[3] : undefined;
  return { best, ponder };
}
