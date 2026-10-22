/**
 * GET /stats/export: the dashboard's numbers as CSV, for a spreadsheet. `kind=series` gives one
 * row per hour, day, week or month of the period (the same `range`, `from`, `to`, `unit` as
 * /stats); `kind=counts` gives every count of every day in the period, field by field
 * (src/lib/stats/fields.ts). Signed in like /stats (src/proxy.ts, checked again here).
 */
import { readDashboard } from "@/lib/server/dashboard";
import { statsAllowed } from "@/lib/server/statsAuth";
import { COUNTING_SINCE, keyPrefix, readDays, readHours, usageStore, utcDay } from "@/lib/server/usage";
import { periodOf } from "@/lib/stats/period";

export const dynamic = "force-dynamic";

const COLUMNS: [string, (m: Record<string, number>) => number][] = [
  ["visits", (m) => m.visit ?? 0],
  ["page_views", (m) => (m.visit ?? 0) + (m.page ?? 0)],
  ["reviews_started", (m) => m.review ?? 0],
  ["reviews_finished", (m) => m.review_done ?? 0],
  ["analyses", (m) => m.analysis ?? 0],
  ["photos", (m) => m.photo ?? 0],
  ["side_lines", (m) => m.side_line ?? 0],
  ["shares", (m) => m.share ?? 0],
  ["add_to_chrome", (m) => m.get_extension ?? 0],
  ["game_lists", (m) => m.lookup ?? 0],
  ["import_errors", (m) => m.import_error ?? 0],
  ["errors", (m) => m.error ?? 0],
  ["seconds_visible", (m) => m.time ?? 0],
  ["new_people", (m) => m.new ?? 0],
  ["returning_people", (m) => m.back ?? 0],
];

const cell = (x: string | number) => (typeof x === "number" ? String(x) : /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

export async function GET(req: Request) {
  if (!statsAllowed(req.headers.get("authorization"))) return new Response("Not found", { status: 404 });
  const db = usageStore();
  if (!db) return new Response("The usage database isn't connected.", { status: 503 });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const now = Date.now();
  const period = periodOf(q, now, COUNTING_SINCE);
  const prefix = keyPrefix();
  let rows: (string | number)[][];
  if (q.kind === "counts") {
    rows = [["period_start_utc", "field", "count"]];
    if (period.rolling) {
      const w = await readHours(db, prefix, period.end, period.hours, false);
      for (const h of w.hours) for (const [f, n] of Object.entries(h.fields)) rows.push([new Date(h.t).toISOString(), f, n]);
    } else {
      for (const d of await readDays(db, prefix, period.days, utcDay(now))) for (const [f, n] of Object.entries(d.fields)) rows.push([d.day, f, n]);
    }
  } else {
    const dash = await readDashboard(db, prefix, period, now);
    rows = [["start_utc", "people", ...COLUMNS.map(([c]) => c)], ...dash.points.map((p) => [new Date(p.t).toISOString(), p.people, ...COLUMNS.map(([, f]) => f(p.m))])];
  }
  const name = `whatsthisposition-usage-${q.kind === "counts" ? "counts" : period.unit}-${period.rolling ? period.key : `${period.days[0] ?? period.from}-to-${period.days.at(-1) ?? period.to}`}.csv`;
  return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
