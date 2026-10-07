import "server-only";

/**
 * A small in-memory rate limiter (sliding window per client IP). It protects the
 * two API routes from accidental floods and abuse: /api/games proxies Chess.com and
 * Lichess (which rate-limit us in turn), and /api/recognize can cost money.
 *
 * In-memory means per server instance: good enough on one container or VPS; on a
 * serverless host each instance keeps its own count (a soft limit, still useful).
 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;

/** The client's IP as the proxy in front of us reports it. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** Records a hit; returns how many seconds to wait if over `limit` hits per `windowMs`, else 0. */
export function rateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return Math.ceil((windowMs - (now - hits[0])) / 1000);
  }
  hits.push(now);
  buckets.set(key, hits);
  return 0;
}
