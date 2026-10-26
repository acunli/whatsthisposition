/**
 * GET /api/reviewed → { games }: how many games have been reviewed on the site, for the home
 * page (src/lib/server/reviewTotal.ts). Public. The CDN keeps each answer for ten minutes, so the
 * database is asked a handful of times an hour however many people open the page.
 */
import { NextResponse } from "next/server";
import { readReviewTotal } from "@/lib/server/reviewTotal";
import { keyPrefix, usageStore } from "@/lib/server/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = usageStore();
  if (!db) return NextResponse.json({ games: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const games = await readReviewTotal(db, keyPrefix());
    return NextResponse.json({ games }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ games: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
