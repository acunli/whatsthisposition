/**
 * The dashboard's periods (/stats?range=…): rolling windows of hours, or whole UTC days up to
 * today, each compared with the same length just before it, and the units its chart can use.
 */

export type Unit = "hour" | "day" | "week" | "month";
export type RangeKey = "24h" | "48h" | "7d" | "30d" | "90d" | "12m" | "all" | "custom";

export const RANGES: { key: Exclude<RangeKey, "custom">; label: string; hours?: number; days?: number }[] = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "48h", label: "48 hours", hours: 48 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "12m", label: "12 months", days: 365 },
  { key: "all", label: "All time" },
];

export interface Period {
  key: RangeKey;
  label: string;
  /** A rolling window of hours ending at `end` (ms, the next hour boundary), or whole days. */
  rolling: boolean;
  end: number;
  hours: number;
  /** The days covered (only days since counting began), and as many days just before. */
  days: string[];
  prevDays: string[];
  unit: Unit;
  units: Unit[];
  /** For a custom period, the days asked for. */
  from: string;
  to: string;
}

const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const isDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));

function span(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += DAY) out.push(dayOf(t));
  return out;
}

/** The units a period of `days` days can be drawn in, and the one it starts in. */
export function unitsFor(days: number): { units: Unit[]; unit: Unit } {
  if (days <= 14) return { units: ["hour", "day"], unit: days <= 7 ? "hour" : "day" };
  if (days <= 31) return { units: ["hour", "day", "week"], unit: "day" };
  if (days <= 120) return { units: ["day", "week"], unit: "day" };
  return { units: ["day", "week", "month"], unit: "week" };
}

/**
 * The period a dashboard address asks for (`range`, `from`/`to` for a custom one, `unit`; the
 * old `days=7|30|90` still works), at time `now`, counting from `since`.
 */
export function periodOf(q: { range?: string; from?: string; to?: string; unit?: string; days?: string }, now: number, since: string): Period {
  const today = dayOf(now);
  const legacy = q.days && ["7", "30", "90"].includes(q.days) ? `${q.days}d` : undefined;
  const asked = q.range ?? legacy ?? "30d";
  const preset = RANGES.find((r) => r.key === asked);
  const end = Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000;
  if (preset?.hours) {
    return { key: preset.key, label: `Last ${preset.label}`, rolling: true, end, hours: preset.hours, days: [], prevDays: [], unit: "hour", units: ["hour"], from: today, to: today };
  }
  let from: string;
  let to = today;
  let key: RangeKey;
  let label: string;
  if (asked === "custom" && isDay(q.from) && isDay(q.to)) {
    [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    if (to > today) to = today;
    if (from > to) from = to;
    const max = dayOf(Date.parse(`${to}T00:00:00Z`) - 730 * DAY);
    if (from < max) from = max;
    key = "custom";
    label = from === to ? from : `${from} to ${to}`;
  } else if (asked === "all") {
    from = since;
    key = "all";
    label = "All time";
  } else {
    const r = preset?.days ? preset : RANGES.find((x) => x.key === "30d")!;
    from = dayOf(now - (r.days! - 1) * DAY);
    key = r.key;
    label = `Last ${r.label}`;
  }
  const length = span(from, to).length;
  const prevFrom = dayOf(Date.parse(`${from}T00:00:00Z`) - length * DAY);
  const prevTo = dayOf(Date.parse(`${from}T00:00:00Z`) - DAY);
  const counted = (ds: string[]) => ds.filter((d) => d >= since && d <= today);
  const { units, unit } = unitsFor(length);
  return {
    key,
    label,
    rolling: false,
    end,
    hours: length * 24,
    days: counted(span(from, to)),
    prevDays: counted(span(prevFrom, prevTo)),
    unit: units.includes(q.unit as Unit) ? (q.unit as Unit) : unit,
    units,
    from,
    to,
  };
}

/** The Monday of a day's ISO week. */
export function weekOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}

/** Days grouped into a chart's buckets (weeks start on Monday; months are calendar months). */
export function groupDays(days: string[], unit: "day" | "week" | "month"): { key: string; start: number; days: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const d of days) {
    const key = unit === "day" ? d : unit === "week" ? weekOf(d) : d.slice(0, 7);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  return [...groups].map(([key, ds]) => ({ key, start: Date.parse(`${unit === "month" ? `${key}-01` : key}T00:00:00Z`), days: ds }));
}
