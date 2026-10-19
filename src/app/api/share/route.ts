/**
 * POST /api/share: stores a finished review someone chose to share and answers its link
 * ({ id, url }). The game must parse, the packed review must unpack to one analysis per
 * position, and the preview summary is re-checked field by field (src/lib/review/shareCard.ts).
 * Only this site's pages may ask, 20 times a minute per address, and up to 256 KB.
 */
import { SITE_URL } from "@/lib/brand";
import { parseGame } from "@/lib/review/pgn";
import { unpackReview } from "@/lib/review/share";
import { readSummary } from "@/lib/review/shareCard";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { saveShare, shareStore } from "@/lib/server/shares";

export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;

const answer = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const sameSite = (origin: string, url: string) => {
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
};

export async function POST(req: Request) {
  const db = shareStore();
  if (!db) return answer(503, { error: "Sharing isn't available here." });
  const origin = req.headers.get("origin");
  if (!origin || !sameSite(origin, req.url)) return answer(403, { error: "Not allowed." });
  const wait = rateLimit(`share:${clientIp(req)}`, 20, 60_000);
  if (wait) return answer(429, { error: `Too many links at once. Try again in ${wait} s.` });
  const text = await req.text();
  if (text.length > MAX_BYTES) return answer(413, { error: "This game is too long to share." });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return answer(400, { error: "Not a review." });
  }
  const { pgn, as, depth, data } = body;
  if (typeof pgn !== "string" || typeof data !== "string" || (as !== "w" && as !== "b") || typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 40) return answer(400, { error: "Not a review." });
  const summary = readSummary(body.summary);
  if (!summary) return answer(400, { error: "Not a review." });
  let moves: number;
  try {
    moves = parseGame(pgn).moves.length;
  } catch {
    return answer(400, { error: "The game doesn't read as PGN." });
  }
  const review = await unpackReview(data);
  if (!review || review.positions.length !== moves + 1 || review.depth !== depth) return answer(400, { error: "The review doesn't match the game." });
  try {
    const id = await saveShare(db, { v: 1, pgn, as, depth, data, summary, at: Date.now() });
    return answer(200, { id, url: `${SITE_URL}/r/${id}` });
  } catch {
    return answer(503, { error: "Couldn't save the link. Try again in a minute." });
  }
}
