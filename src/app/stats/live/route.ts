/**
 * GET /stats/live: who's on the site right now, for the dashboard's Live view (polled while
 * it's open and visible). Signed in like /stats (src/proxy.ts, checked again here).
 */
import { statsAllowed } from "@/lib/server/statsAuth";
import { keyPrefix, readLive, usageStore } from "@/lib/server/usage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!statsAllowed(req.headers.get("authorization"))) return new Response("Not found", { status: 404 });
  const db = usageStore();
  if (!db) return Response.json({ ok: false }, { status: 503 });
  try {
    return Response.json({ ok: true, live: await readLive(db, keyPrefix()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
