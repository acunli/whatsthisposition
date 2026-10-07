import "server-only";

/**
 * A small in-memory rate limiter (sliding window per client IP). It protects the
 * two API routes from accidental floods and abuse: /api/games proxies Chess.com and
 * Lichess (which rate-limit us in turn), and /api/recognize can cost money.
 *
 * In-memory means per server instance: exact on one container, softer on Vercel,
 * where each function instance keeps its own count (still useful against floods).
 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;

/**
 * The client's IP as the proxy in front of us reports it. Vercel and Caddy both
 * overwrite x-forwarded-for with the real address, so a visitor can't fake it there.
 * Other headers are only trusted when CLIENT_IP_HEADER names one (for example
 * cf-connecting-ip behind Cloudflare), because anyone can send them.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const trusted = process.env.CLIENT_IP_HEADER?.trim();
  const ip = (trusted && h.get(trusted)) || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip");
  return ip?.trim() || "local";
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
