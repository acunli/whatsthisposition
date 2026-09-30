/**
 * The recognition result as seen in the photo: 8 rows top→bottom, 8 columns
 * left→right. Mapping it to real squares needs the player's orientation choice;
 * we never guess it.
 */
import { z } from "zod";
import { toSquare } from "../chess/board";
import { pieceFromChar } from "../chess/fen";
import type { Placement, Square } from "../chess/types";

export const CELL_VALUES = ["", "K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"] as const;

export const cellSchema = z.object({
  piece: z.enum(CELL_VALUES),
  confident: z.boolean(),
});

export const recognitionSchema = z.object({
  board_found: z.boolean(),
  /** Why the board couldn't be read, or anything the player should double-check. */
  notes: z.string().max(400),
  rows: z.array(z.array(cellSchema).length(8)).length(8),
});

export type Recognition = z.infer<typeof recognitionSchema>;

export interface RecognitionResponse {
  ok: true;
  boardFound: boolean;
  notes: string;
  rows: Recognition["rows"];
  provider: string;
  model: string;
}

export interface RecognitionError {
  ok: false;
  code: "not_configured" | "bad_request" | "too_large" | "unreadable" | "provider_error" | "invalid_output";
  message: string;
}

/**
 * @param whiteAtBottom true if White's side of the board is at the bottom of the photo.
 */
export function gridToPlacement(rows: Recognition["rows"], whiteAtBottom: boolean): { placement: Placement; uncertain: Square[] } {
  const placement: Placement = {};
  const uncertain: Square[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = rows[r][c];
      const sq = (whiteAtBottom ? toSquare(c, 7 - r) : toSquare(7 - c, r))!;
      const piece = cell.piece ? pieceFromChar(cell.piece) : null;
      if (piece) placement[sq] = piece;
      if (!cell.confident) uncertain.push(sq);
    }
  }
  return { placement, uncertain };
}
