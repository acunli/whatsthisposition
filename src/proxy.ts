/**
 * Two jobs, each on its own paths:
 * - A Chess.com or Lichess address typed after the site's own (whatsthisposition.com/chess.com/game/live/1…)
 *   goes to the home page with that link (?game=), which opens the game's review or the player's games.
 * - Guards the owner's usage dashboard: /stats asks for the password in STATS_PASSWORD (HTTP Basic)
 *   and doesn't exist without it. Runs only on /stats and its data routes (/stats/live, /stats/export);
 *   each checks again itself.
 */
import { NextResponse, type NextRequest } from "next/server";
import { linkInPath } from "@/lib/review/sharedLink";
import { STATS_CHALLENGE, statsAllowed, statsEnabled } from "@/lib/server/statsAuth";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname !== "/stats" && !pathname.startsWith("/stats/")) {
    const link = linkInPath(pathname + search);
    if (!link) return NextResponse.next();
    return NextResponse.redirect(new URL(`/?game=${encodeURIComponent(link)}`, req.url), 307);
  }
  if (!statsEnabled()) return new NextResponse("Not found", { status: 404 });
  if (statsAllowed(req.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Sign in to see the usage numbers.", { status: 401, headers: { "WWW-Authenticate": STATS_CHALLENGE, "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/stats", "/stats/:path*", "/(https?:.*)", "/((?:www\\.|m\\.)?(?:chess\\.com|lichess\\.org)(?:/.*)?)"],
};
