/**
 * GET /share?title=&text=&url=: the installed app's share target (manifest.ts). A phone's share sheet
 * sends what the Chess.com or Lichess app shares: a game or profile link goes to the home page with
 * it (?game=), a PGN opens its review (#review=, the fragment the extension uses, never sent back to
 * a server); anything else opens the home page.
 */
import { NextResponse } from "next/server";
import { linkInText, looksLikeGame } from "@/lib/review/sharedLink";
import { reviewLink } from "@/lib/review/share";

export const dynamic = "force-dynamic";

/** A PGN is sent in the redirect's fragment: longer than this, it's a collection, not a game. */
const MAX_PGN = 24_000;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const parts = ["url", "text", "title"].map((k) => q.get(k)?.trim() ?? "").filter(Boolean);
  const link = linkInText(parts.join(" "));
  const pgn = parts.find(looksLikeGame);
  const to = link ? `/?ref=app&game=${encodeURIComponent(link)}` : pgn && pgn.length <= MAX_PGN ? `/?ref=app${reviewLink("", pgn).slice(1)}` : "/?ref=app";
  return NextResponse.redirect(new URL(to, req.url), { status: 303, headers: { "Cache-Control": "no-store" } });
}
