import "server-only";

/**
 * How many games have been reviewed on the site, by everyone, since counting began: the public
 * number on the home page (GET /api/reviewed), read live. Each review adds one to a counter as it
 * is counted (recordUse); the reviews counted before that counter existed are summed once from
 * the usage counts and kept beside it. A read is one command.
 */
import { isGameReview } from "../stats/fields";
import { COUNTING_SINCE, daysBetween, readDays, usageKeys, utcDay, type UsageDb } from "./usage";

const num = (x: unknown) => Number(x) || 0;

/** Games reviewed in a set of counts (a day's fields, without their hour). */
export function reviewsIn(fields: Record<string, number>): number {
  let n = 0;
  for (const [f, c] of Object.entries(fields)) if (isGameReview(f)) n += c;
  return n;
}

/** Games reviewed on the site up to now (at `now`, ms). */
export async function readReviewTotal(db: UsageDb, prefix: string, now = Date.now()): Promise<number> {
  const K = usageKeys(prefix);
  const [kept, base] = await db.mget(K.reviews, K.reviewsBase);
  if (base !== null && base !== undefined) return num(kept) + num(base);
  // The first read: everything counted so far (the finished days' roll-ups and today's hourly
  // counts), less what the counter already has, is what came before it. A review counted while
  // this runs can make the total one off, once.
  const days = await readDays(db, prefix, daysBetween(COUNTING_SINCE, utcDay(now)), utcDay(now));
  const counted = days.reduce((n, d) => n + reviewsIn(d.fields), 0);
  const [since] = await db.mget(K.reviews);
  if ((await db.set(K.reviewsBase, String(counted - num(since)), { nx: true })) !== null) return counted;
  // Another read set it first.
  const [k, b] = await db.mget(K.reviews, K.reviewsBase);
  return num(k) + num(b);
}
