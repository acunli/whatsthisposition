/**
 * The compact board format asked of OpenAI-compatible vision models: 8 strings of
 * 8 characters (FEN piece letters, "." for empty), top row of the photo first.
 * Smaller models follow this far more reliably than a 64-object JSON grid.
 */
import { z } from "zod";
import type { Recognition } from "./grid";

const PIECE = /^[KQRBNPkqrbnp.]$/;

export const compactSchema = z.object({
  board_found: z.boolean(),
  rows: z.array(z.string()),
  unsure: z.array(z.union([z.string(), z.array(z.number())])).optional().default([]),
  notes: z.string().optional().default(""),
});

/** Pulls the first JSON object out of a model reply (handles ```json fences and <think> blocks). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Normalises one row: accepts "r.bqkbnr", "r1bqkbnr" (FEN digits) or "r . b q k b n r". */
export function normaliseRow(row: string): string {
  const compact = row.replace(/[\s,|]/g, "");
  return compact.replace(/[1-8]/g, (d) => ".".repeat(Number(d)));
}

function unsureKey(u: string | number[]): string | null {
  if (Array.isArray(u)) return u.length === 2 ? `${u[0]},${u[1]}` : null;
  const m = u.match(/(\d)\D+(\d)/);
  return m ? `${m[1]},${m[2]}` : null;
}

/**
 * Converts a parsed compact reply to the internal Recognition shape.
 * Throws with a short reason when the board isn't a clean 8×8 grid.
 */
export function compactToRecognition(input: unknown): Recognition {
  const parsed = compactSchema.parse(input);
  if (!parsed.board_found) {
    return {
      board_found: false,
      notes: parsed.notes || "No complete chessboard was found in the photo.",
      rows: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ piece: "" as const, confident: false }))),
    };
  }
  let rows = parsed.rows.map(normaliseRow);
  // Some models answer with a single FEN board field.
  if (rows.length === 1 && rows[0].includes("/")) rows = rows[0].split("/").map(normaliseRow);
  if (rows.length !== 8) throw new Error(`expected 8 rows, got ${rows.length}`);
  rows.forEach((r, i) => {
    if (r.length !== 8) throw new Error(`row ${i + 1} has ${r.length} squares instead of 8`);
    for (const ch of r) if (!PIECE.test(ch)) throw new Error(`unknown piece letter "${ch}" in row ${i + 1}`);
  });
  const unsure = new Set(parsed.unsure.map(unsureKey).filter((x): x is string => !!x));
  return {
    board_found: true,
    notes: parsed.notes.slice(0, 400),
    rows: rows.map((r, ri) =>
      [...r].map((ch, ci) => ({
        piece: (ch === "." ? "" : ch) as Recognition["rows"][number][number]["piece"],
        confident: !unsure.has(`${ri},${ci}`),
      })),
    ),
  };
}
