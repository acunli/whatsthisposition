/**
 * Reads the counter's fields (src/lib/stats/fields.ts) back into what the dashboard shows: uses
 * by kind and source, by channel and page, places, devices, page speed and review times.
 */
import { DEVICE_CLASS_NAMES, REVIEW_SECONDS, VITALS, VITAL_NAMES, type VitalName } from "./fields";

export type Counts = Record<string, number>;
type Table = Record<string, Counts>;

export interface VitalCounts {
  /** Loads per range of values (VITALS[name].bounds), all devices, and per device type. */
  all: number[];
  byDevice: Record<string, number[]>;
}

export interface Breakdown {
  /** Uses of each kind. */
  events: Counts;
  /** Uses of each kind, by source. */
  sources: Table;
  /** Per channel the visit came from: visits ("visit"), and the uses that followed. */
  channels: Table;
  /** Per page: views (a page load or a page opened within the site), landings ("visit"), uses there, and seconds visible ("time"). */
  pages: Table;
  countries: Counts;
  /** "SG|01": a region within its country. */
  regions: Counts;
  /** "SG|Singapore": a city within its country. */
  cities: Counts;
  languages: Counts;
  /** Visits by the visitor's own hour (0–23) and weekday ("Mon"…). */
  localHours: number[];
  localDays: Counts;
  /** Visits by device type, system, browser and each of DEVICE_CLASSES. */
  tech: Table;
  /** People's first use of a day: new this month, or back from an earlier day. */
  returning: { new: number; back: number };
  vitals: Record<VitalName, VitalCounts>;
  /** Finished reviews per depth: how many, their seconds, and how many per range of REVIEW_SECONDS. */
  reviewTime: Record<string, { count: number; seconds: number; buckets: number[] }>;
  /** Seconds the site's pages were visible, in all. */
  time: number;
}

const inc = (c: Counts, k: string, n: number) => void (c[k] = (c[k] ?? 0) + n);
const incIn = (t: Table, row: string, k: string, n: number) => inc((t[row] ??= {}), k, n);

const TECH = ["device", "os", "browser", ...DEVICE_CLASS_NAMES] as const;

export function emptyBreakdown(): Breakdown {
  return {
    events: {},
    sources: {},
    channels: {},
    pages: {},
    countries: {},
    regions: {},
    cities: {},
    languages: {},
    localHours: Array(24).fill(0),
    localDays: {},
    tech: Object.fromEntries(TECH.map((k) => [k, {}])),
    returning: { new: 0, back: 0 },
    vitals: Object.fromEntries(VITAL_NAMES.map((v) => [v, { all: Array(VITALS[v].bounds.length + 1).fill(0), byDevice: {} }])) as Breakdown["vitals"],
    reviewTime: {},
    time: 0,
  };
}

/** Adds counts (fields without their hour) to a breakdown. */
export function addFields(b: Breakdown, fields: Counts): Breakdown {
  for (const [f, n] of Object.entries(fields)) {
    if (!n) continue;
    const p = f.split("|");
    switch (p[0]) {
      case "e": {
        const [, e, s, c, page] = p;
        inc(b.events, e, n);
        if (s) incIn(b.sources, e, s, n);
        // Before 2026-10-22 the channel was its own use, sent with each page load.
        if (e === "arrive") incIn(b.channels, s, "visit", n);
        else if (c) incIn(b.channels, c, e, n);
        if (page) {
          incIn(b.pages, page, e, n);
          if (e === "visit" || e === "page") incIn(b.pages, page, "views", n);
        }
        break;
      }
      case "g": {
        const [, country, region, city, lang, hour, day] = p;
        if (country) inc(b.countries, country, n);
        if (country && region) inc(b.regions, `${country}|${region}`, n);
        if (country && city) inc(b.cities, `${country}|${city}`, n);
        if (lang) inc(b.languages, lang, n);
        if (/^\d\d$/.test(hour ?? "")) b.localHours[Number(hour)] += n;
        if (day) inc(b.localDays, day, n);
        break;
      }
      case "t":
        TECH.forEach((k, i) => p[i + 1] && inc(b.tech[k], p[i + 1], n));
        break;
      case "s":
        b.time += n;
        if (p[1]) incIn(b.pages, p[1], "time", n);
        break;
      case "w": {
        const [, name, device, range] = p;
        const v = b.vitals[name as VitalName];
        const i = Number(range);
        if (!v || !(i >= 0 && i < v.all.length)) break;
        v.all[i] += n;
        (v.byDevice[device] ??= Array(v.all.length).fill(0))[i] += n;
        break;
      }
      case "d": {
        const i = Number(p[2]);
        const r = (b.reviewTime[p[1]] ??= { count: 0, seconds: 0, buckets: Array(REVIEW_SECONDS.length + 1).fill(0) });
        r.count += n;
        if (i >= 0 && i < r.buckets.length) r.buckets[i] += n;
        break;
      }
      case "ds":
        (b.reviewTime[p[1]] ??= { count: 0, seconds: 0, buckets: Array(REVIEW_SECONDS.length + 1).fill(0) }).seconds += n;
        break;
      case "r":
        if (p[1] === "new" || p[1] === "back") b.returning[p[1]] += n;
        break;
    }
  }
  return b;
}

export const breakdown = (...fields: Counts[]) => fields.reduce(addFields, emptyBreakdown());

/** A value's place in counts per range: the q-quantile, read linearly within its range. */
export function quantile(buckets: number[], bounds: readonly number[], q = 0.75): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = q * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] && seen + buckets[i] >= target) {
      const lo = i ? bounds[i - 1] : 0;
      const hi = i < bounds.length ? bounds[i] : bounds[bounds.length - 1] * 2;
      return lo + (hi - lo) * ((target - seen) / buckets[i]);
    }
    seen += buckets[i];
  }
  return bounds[bounds.length - 1];
}

/** Loads rated good, needing improvement and poor (exact: the limits are range bounds). */
export function ratings(name: VitalName, buckets: number[]): { good: number; fair: number; poor: number } {
  const { bounds, good, poor } = VITALS[name];
  const g = bounds.indexOf(good as never);
  const p = bounds.indexOf(poor as never);
  const sum = (a: number, b: number) => buckets.slice(a, b).reduce((x, y) => x + y, 0);
  return { good: sum(0, g + 1), fair: sum(g + 1, p + 1), poor: sum(p + 1, buckets.length) };
}

/** Rows of a count table, biggest first, the rest folded into "Other" past `top`. */
export function ranked(c: Counts, top = Infinity): { key: string; value: number }[] {
  const rows = Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  if (rows.length <= top) return rows;
  const rest = rows.slice(top - 1).reduce((a, r) => a + r.value, 0);
  return [...rows.slice(0, top - 1), { key: "Other", value: rest }];
}
