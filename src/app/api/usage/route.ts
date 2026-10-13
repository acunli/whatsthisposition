/**
 * POST /api/usage: counts one use of the site, anonymously (src/lib/usage.ts lists what can be
 * counted; src/lib/server/usage.ts says how). Always answers quickly and never fails the page:
 * without the database, from a bot, over the rate limit or from another site, it just counts nothing.
 */
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { isAutomated, keyPrefix, recordUse, tokenSecret, usageStore, utcDay, visitorToken } from "@/lib/server/usage";
import { parseUse } from "@/lib/usage";

export const dynamic = "force-dynamic";

const sameSite = (origin: string, url: string) => {
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false; // "null" and other opaque origins
  }
};

const done = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const db = usageStore();
  if (!db) return done();
  // Only this site's own pages count (a browser sends Origin with sendBeacon and fetch).
  const origin = req.headers.get("origin");
  if (origin && !sameSite(origin, req.url)) return done(403);
  const ua = req.headers.get("user-agent");
  if (isAutomated(ua)) return done();
  const ip = clientIp(req);
  if (rateLimit(`usage:${ip}`, 60, 60_000)) return done();
  if (Number(req.headers.get("content-length") ?? 0) > 256) return done(413);
  let use;
  try {
    use = parseUse(await req.json());
  } catch {
    return done(400);
  }
  if (!use) return done(400);
  const day = utcDay();
  try {
    await recordUse(db, keyPrefix(), day, use.e, use.s, visitorToken(tokenSecret(), day, ip, ua!), req.headers.get("x-vercel-ip-country"));
  } catch {
    // The counter is best effort: a database hiccup must never show up for the visitor.
  }
  return done();
}
