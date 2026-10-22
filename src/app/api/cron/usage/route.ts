/**
 * GET /api/cron/usage: the usage counter's daily housekeeping, run by Vercel Cron (vercel.json)
 * just after midnight UTC. It rolls up the last few finished days (so the dashboard reads them
 * in one go), takes the day's outside numbers (the extension's store listing, GitHub), and drops
 * per-hour sketches older than HOUR_SKETCH_DAYS (their counts stay in the roll-ups).
 *
 * With CRON_SECRET set, only Vercel's call (which carries it) is let in. Without it the job is
 * still harmless to call: everything it does is idempotent, and it runs at most a few times an hour.
 */
import { rateLimit } from "@/lib/server/rateLimit";
import { takeSnapshot } from "@/lib/server/snapshot";
import { HOUR_SKETCH_DAYS, dayRange, forgetHours, keyPrefix, readDays, saveSnapshot, usageStore, utcDay } from "@/lib/server/usage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (rateLimit("cron:usage", 4, 3_600_000)) return Response.json({ ok: false, reason: "ran recently" }, { status: 429 });
  const db = usageStore();
  if (!db) return Response.json({ ok: false, reason: "no database" });
  const prefix = keyPrefix();
  const today = utcDay();
  const done: string[] = [];
  // The last three finished days (a missed run catches up).
  await readDays(db, prefix, dayRange(today, 4).slice(0, 3), today);
  done.push("roll-ups");
  await saveSnapshot(db, prefix, await takeSnapshot(today));
  done.push("snapshot");
  const old = dayRange(today, HOUR_SKETCH_DAYS + 5).slice(0, 5);
  for (const d of old) await forgetHours(db, prefix, d);
  done.push("old hourly sketches");
  return Response.json({ ok: true, done }, { headers: { "Cache-Control": "no-store" } });
}
