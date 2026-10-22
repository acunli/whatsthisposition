import "server-only";

/**
 * Everything /stats shows for one period, read from the usage counter (src/lib/server/usage.ts)
 * in a handful of commands: the period's counts, the same length before it, distinct people,
 * a chart series in the period's unit, every hour (for the week-by-hour heatmap) and the daily
 * outside numbers.
 */
import { USAGE_EVENT_NAMES, type UsageEvent } from "../usage";
import { groupDays, type Period } from "../stats/period";
import { breakdown, type Breakdown } from "../stats/report";
import {
  COUNTING_SINCE,
  ENGAGED_EVENTS,
  HOURLY_SINCE,
  HOURS,
  addMetrics,
  countPeople,
  daysBetween,
  readDays,
  readHours,
  readSnapshots,
  usageKeys,
  utcDay,
  type DayData,
  type HourMetrics,
  type Snapshot,
  type UsageDb,
} from "./usage";

/** One bucket of the chart: when it starts, its distinct people, and its metrics (HourMetrics). */
export interface TrendPoint {
  t: number;
  people: number;
  m: HourMetrics;
}

export interface Dashboard {
  period: Period;
  now: number;
  points: TrendPoint[];
  /** The period before, in the same unit (aligned by position). */
  prevPoints: TrendPoint[];
  /** Every hour with counts: its start and its visits (pages loaded). */
  hourly: { t: number; visits: number }[];
  totals: Breakdown;
  prev: Breakdown;
  people: number;
  prevPeople: number;
  /** Distinct people who did each thing, in the period, and who did more than open pages. */
  who: Partial<Record<UsageEvent, number>>;
  engaged: number;
  /**
   * Distinct people first seen this month on a day of the period, and the period's people on
   * days with monthly tokens (from HOURLY_SINCE): the rest of those were back from earlier.
   */
  newcomers: number;
  tracked: number;
  snapshots: Snapshot[];
  countingSince: string;
  hourlySince: string;
}

/** A day's metrics from its counts (also right for days counted before hourly counting). */
function dayMetrics(d: DayData): HourMetrics {
  const m: HourMetrics = {};
  for (const [f, n] of Object.entries(d.fields)) addMetrics(m, f, n);
  return m;
}

const sumMetrics = (ms: HourMetrics[]) => {
  const out: HourMetrics = {};
  for (const m of ms) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** A day period's chart: hours, days, or weeks and months (whose people are counted as one group each). */
async function seriesOf(db: UsageDb, prefix: string, days: DayData[], unit: Period["unit"], now: number): Promise<TrendPoint[]> {
  if (unit === "hour") {
    return days.flatMap((d) =>
      HOURS.map((hh, i) => ({ t: Date.parse(`${d.day}T${hh}:00:00Z`), people: d.hourPeople[i] ?? 0, m: d.hours[i] ?? {} })).filter((p) => p.t <= now),
    );
  }
  if (unit === "day") return days.map((d) => ({ t: Date.parse(`${d.day}T00:00:00Z`), people: d.people, m: dayMetrics(d) }));
  const K = usageKeys(prefix);
  const groups = groupDays(
    days.map((d) => d.day),
    unit,
  );
  const people = await countPeople(
    db,
    groups.map((g) => g.days.map(K.seen)),
  );
  const byDay = new Map(days.map((d) => [d.day, d]));
  return groups.map((g, i) => ({ t: g.start, people: people[i], m: sumMetrics(g.days.map((d) => dayMetrics(byDay.get(d)!))) }));
}

/**
 * The period before, bucket by bucket under the period's own: the bucket `shift` ms earlier (an
 * empty one when nothing was counted yet). Weeks and months, which don't shift evenly, pair by position.
 */
function align(points: TrendPoint[], before: TrendPoint[], shift: number, byTime: boolean): TrendPoint[] {
  if (!byTime) return points.map((p, i) => before[i] ?? { t: p.t - shift, people: 0, m: {} });
  const at = new Map(before.map((p) => [p.t, p]));
  return points.map((p) => at.get(p.t - shift) ?? { t: p.t - shift, people: 0, m: {} });
}

export async function readDashboard(db: UsageDb, prefix: string, period: Period, now = Date.now()): Promise<Dashboard> {
  const today = utcDay(now);
  const snapshots = readSnapshots(db, prefix, daysBetween(COUNTING_SINCE, today));
  const base = { period, now, countingSince: COUNTING_SINCE, hourlySince: HOURLY_SINCE };
  if (period.rolling) {
    const K = usageKeys(prefix);
    const touched = [...new Set(Array.from({ length: period.hours }, (_, i) => utcDay(period.end - (i + 1) * 3_600_000)))];
    const [cur, before, [newcomers]] = await Promise.all([
      readHours(db, prefix, period.end, period.hours),
      readHours(db, prefix, period.end - period.hours * 3_600_000, period.hours, false),
      countPeople(db, [touched.map(K.fresh)]),
    ]);
    const point = (h: (typeof cur.hours)[number]): TrendPoint => ({ t: h.t, people: h.people, m: h.metrics });
    return {
      ...base,
      points: cur.hours.map(point),
      prevPoints: align(cur.hours.map(point), before.hours.map(point), period.hours * 3_600_000, true),
      hourly: cur.hours.filter((h) => h.metrics.visit).map((h) => ({ t: h.t, visits: h.metrics.visit })),
      totals: breakdown(...cur.hours.map((h) => h.fields)),
      prev: breakdown(...before.hours.map((h) => h.fields)),
      people: cur.people,
      prevPeople: before.people,
      who: cur.who,
      engaged: cur.engaged,
      newcomers: Math.min(newcomers, cur.people),
      tracked: cur.people,
      snapshots: await snapshots,
    };
  }
  const K = usageKeys(prefix);
  const [days, prevDays] = await Promise.all([readDays(db, prefix, period.days, today), readDays(db, prefix, period.prevDays, today)]);
  const groups = [
    period.days.map(K.seen),
    period.prevDays.map(K.seen),
    period.days.flatMap((d) => ENGAGED_EVENTS.map((e) => K.who(d, e))),
    period.days.map(K.fresh),
    period.days.filter((d) => d >= HOURLY_SINCE).map(K.seen),
    ...USAGE_EVENT_NAMES.map((e) => period.days.map((d) => K.who(d, e))),
  ];
  const [people, prevPeople, engaged, newcomers, tracked, ...perEvent] = await countPeople(db, groups);
  const [points, prevPoints] = await Promise.all([seriesOf(db, prefix, days, period.unit, now), seriesOf(db, prefix, prevDays, period.unit, now)]);
  return {
    ...base,
    points,
    prevPoints: align(points, prevPoints, period.hours * 3_600_000, period.unit === "hour" || period.unit === "day"),
    hourly: days.flatMap((d) => HOURS.map((hh, i) => ({ t: Date.parse(`${d.day}T${hh}:00:00Z`), visits: d.hours[i]?.visit ?? 0 })).filter((h) => h.visits)),
    totals: breakdown(...days.map((d) => d.fields)),
    prev: breakdown(...prevDays.map((d) => d.fields)),
    people,
    prevPeople,
    who: Object.fromEntries(USAGE_EVENT_NAMES.map((e, i) => [e, perEvent[i]]).filter(([, n]) => n)),
    engaged,
    newcomers: Math.min(newcomers, tracked),
    tracked,
    snapshots: await snapshots,
  };
}
