/**
 * GET /api/reviewed → { games }: how many games have been reviewed on the site, for the home
 * page's live total (src/lib/server/reviewTotal.ts). Public. The CDN keeps each answer for four
 * seconds, so however many people watch the number, the database is asked at most every few
 * seconds, one command each time.
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
    return NextResponse.json({ games }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=4, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ games: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
