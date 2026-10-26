import "server-only";

/**
 * How many games have been reviewed on the site, by everyone, since counting began: the public
 * number on the home page (GET /api/reviewed). It is read from the usage counts
 * (src/lib/server/usage.ts) rather than kept apart: the finished days are summed once a day from
 * their roll-ups and kept under one key, and today's reviews are read from today's hourly counts,
 * so a read costs two commands.
 */
import { SHARED_REVIEW_PAGE } from "../stats/fields";
import { COUNTING_SINCE, countsOf, daysBetween, readDays, usageKeys, utcDay, type UsageDb } from "./usage";

/** Long enough for the day it sums up to, and the next. */
const KEEP_SECONDS = 2 * 86_400;

/**
 * Whether a count (a field without its hour) is games reviewed: every review started on the site,
 * but not a shared review or a published one (/games/…) being opened, which was reviewed before.
 */
export function isGameReview(f: string): boolean {
  const [kind, event, , , page = ""] = f.split("|");
  return kind === "e" && event === "review" && page !== SHARED_REVIEW_PAGE && !page.startsWith("/games/");
}

/** Games reviewed in a set of counts: a day's fields, or an hourly hash ("HH|e|review|…"). */
export function reviewsIn(fields: Record<string, number>, hourly = false): number {
  let n = 0;
  for (const [f, c] of Object.entries(fields)) if (isGameReview(hourly ? f.slice(3) : f)) n += c;
  return n;
}

/** Games reviewed on the site up to now (at `now`, ms). */
export async function readReviewTotal(db: UsageDb, prefix: string, now = Date.now()): Promise<number> {
  const K = usageKeys(prefix);
  const today = utcDay(now);
  const before = K.reviewsBefore(today);
  const [kept, [hours]] = await Promise.all([db.get(before), db.pipeline().hgetall(K.hours(today)).exec()]);
  let done = Number(kept);
  if (kept === null || kept === undefined || !Number.isFinite(done)) {
    const days = today > COUNTING_SINCE ? daysBetween(COUNTING_SINCE, utcDay(Date.parse(`${today}T00:00:00Z`) - 86_400_000)) : [];
    done = (await readDays(db, prefix, days, today)).reduce((n, d) => n + reviewsIn(d.fields), 0);
    await db.set(before, String(done), { ex: KEEP_SECONDS });
  }
  return done + reviewsIn(countsOf(hours), true);
}
