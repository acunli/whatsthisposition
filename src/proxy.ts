/**
 * Guards the owner's usage dashboard: /stats asks for the password in STATS_PASSWORD (HTTP Basic)
 * and doesn't exist without it. Runs only on /stats; the page checks again itself.
 */
import { NextResponse, type NextRequest } from "next/server";
import { STATS_CHALLENGE, statsAllowed, statsEnabled } from "@/lib/server/statsAuth";

export function proxy(req: NextRequest) {
  if (!statsEnabled()) return new NextResponse("Not found", { status: 404 });
  if (statsAllowed(req.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Sign in to see the usage numbers.", { status: 401, headers: { "WWW-Authenticate": STATS_CHALLENGE, "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/stats"],
};
