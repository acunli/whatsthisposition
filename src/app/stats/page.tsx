/**
 * The owner's usage dashboard: how many people use the site, and for what. Signed in with
 * STATS_PASSWORD (src/proxy.ts, checked again here). Numbers come from the anonymous counter
 * (src/lib/server/usage.ts); referrers, pages and devices are in Vercel Web Analytics.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DailyColumns } from "@/components/stats/DailyColumns";
import { statsAllowed } from "@/lib/server/statsAuth";
import { keyPrefix, readUsage, usageStore, utcDay, type UsageReport } from "@/lib/server/usage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage", robots: { index: false, follow: false } };

const PEOPLE = "#ea6420";
const REVIEWS = "#3d9be0";
const RANGES = [7, 30, 90];

const REVIEW_FROM: Record<string, string> = {
  chesscom: "Chess.com username",
  lichess: "Lichess",
  pgn: "Pasted PGN",
  file: "PGN file",
  extension: "From the extension",
  link: "Shared review link",
};
const ANALYSIS_FROM: Record<string, string> = {
  fen: "Pasted FEN",
  sample: "Sample position",
  setup: "Set up by hand",
  photo: "From a photo",
  review: "From a review",
  link: "Position link",
};

const fmt = (n: number) => n.toLocaleString("en");
const people = (n: number) => `by ${fmt(n)} ${n === 1 ? "person" : "people"}`;
const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** Counts for one event's sources, biggest first, with labels. */
function sources(totals: Record<string, number>, event: string, labels: Record<string, string>) {
  return Object.entries(labels)
    .map(([s, label]) => ({ label, value: totals[`${event}:${s}`] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

function countries(totals: Record<string, number>) {
  const rows = Object.entries(totals)
    .filter(([k]) => k.startsWith("country:"))
    .map(([k, value]) => ({ label: regions.of(k.slice(8)) ?? k.slice(8), value }))
    .sort((a, b) => b.value - a.value);
  if (rows.length <= 8) return rows;
  const rest = rows.slice(7).reduce((a, r) => a + r.value, 0);
  return [...rows.slice(0, 7), { label: "Other", value: rest }];
}

function Bars({ rows, color, unit, empty }: { rows: { label: string; value: number }[]; color: string; unit: string; empty: string }) {
  if (!rows.length) return <p className="small muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="stats-bars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${fmt(r.value)} ${unit}`}>
          <span className="stats-bar-label">{r.label}</span>
          <span className="stats-bar-track">
            <span className="stats-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
            <b className="stats-bar-value">{fmt(r.value)}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile-label">{label}</span>
      <b className="stats-tile-value">{fmt(value)}</b>
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}

function delta(now: number, before: number) {
  if (!before) return now ? "new this period" : "no visits yet";
  const d = Math.round(((now - before) / before) * 100);
  return `${d >= 0 ? "+" : "−"}${Math.abs(d)}% on the period before`;
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!statsAllowed((await headers()).get("authorization"))) notFound();
  const asked = Number((await searchParams).days);
  const days = RANGES.includes(asked) ? asked : 30;
  const db = usageStore();
  let report: UsageReport | null = null;
  let error = false;
  if (db) {
    try {
      report = await readUsage(db, keyPrefix(), days, utcDay());
    } catch {
      error = true;
    }
  }
  const t = report?.totals ?? {};
  const env = process.env.VERCEL_ENV ?? "local";

  return (
    <main className="stats">
      <header className="stats-head">
        <div>
          <p className="eyebrow">Usage</p>
          <h1 className="stats-title">Who&apos;s using it</h1>
          <p className="small muted">
            Counted anonymously, per UTC day: no cookies, and no IP addresses or identifiers are stored.
            {env !== "production" && ` These are ${env} numbers, kept apart from the real ones.`}
          </p>
        </div>
        <nav className="stats-ranges" aria-label="Period">
          {RANGES.map((r) => (
            <Link key={r} href={`/stats?days=${r}`} className={r === days ? "chip chip-on" : "chip"} aria-current={r === days ? "page" : undefined}>
              Last {r} days
            </Link>
          ))}
        </nav>
      </header>

      {!db ? (
        <p className="notice">The usage database isn&apos;t connected here (KV_REST_API_URL and KV_REST_API_TOKEN), so nothing is counted.</p>
      ) : error || !report ? (
        <p className="notice notice-error">The usage database didn&apos;t answer. Try again in a minute.</p>
      ) : (
        <>
          <section className="stats-hero" aria-label="People">
            <span className="stats-tile-label">People who opened the site</span>
            <b className="stats-hero-value">{fmt(report.visitors)}</b>
            <span className="small muted">{delta(report.visitors, report.previousVisitors)} (distinct visitors, estimated within about 1%)</span>
          </section>

          <section className="stats-tiles" aria-label="What they did">
            <Tile label="Visits" value={t.visit ?? 0} />
            <Tile label="Reviews started" value={t.review ?? 0} note={people(report.people.review)} />
            <Tile label="Reviews finished" value={t.review_done ?? 0} />
            <Tile label="Positions analysed" value={t.analysis ?? 0} note={people(report.people.analysis)} />
            <Tile label="Photos read" value={t.photo ?? 0} />
            <Tile label="From the extension" value={t["visit:extension"] ?? 0} />
            <Tile label="Side lines tried" value={t.side_line ?? 0} />
            <Tile label="Add to Chrome clicks" value={t.get_extension ?? 0} note={people(report.people.get_extension)} />
          </section>

          <section className="stats-card">
            <h2 className="stats-h2">People per day</h2>
            <DailyColumns points={report.days.map((d) => ({ day: d.day, value: d.visitors }))} color={PEOPLE} unit="people" label={`Distinct visitors per day, last ${days} days`} />
          </section>
          <section className="stats-card">
            <h2 className="stats-h2">Reviews per day</h2>
            <DailyColumns points={report.days.map((d) => ({ day: d.day, value: d.n.review ?? 0 }))} color={REVIEWS} unit="reviews" label={`Reviews started per day, last ${days} days`} />
          </section>

          <div className="stats-split">
            <section className="stats-card">
              <h2 className="stats-h2">Where reviews come from</h2>
              <Bars rows={sources(t, "review", REVIEW_FROM)} color={REVIEWS} unit="reviews" empty="No reviews yet." />
            </section>
            <section className="stats-card">
              <h2 className="stats-h2">How analyses start</h2>
              <Bars rows={sources(t, "analysis", ANALYSIS_FROM)} color={REVIEWS} unit="analyses" empty="No analyses yet." />
            </section>
            <section className="stats-card">
              <h2 className="stats-h2">Countries (visits)</h2>
              <Bars rows={countries(t)} color={PEOPLE} unit="visits" empty="No visits yet." />
            </section>
          </div>

          <details className="stats-card stats-table-wrap">
            <summary>Every day, as a table</summary>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th>People</th>
                  <th>Visits</th>
                  <th>Reviews</th>
                  <th>Finished</th>
                  <th>Analyses</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {[...report.days].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{fmt(d.visitors)}</td>
                    <td>{fmt(d.n.visit ?? 0)}</td>
                    <td>{fmt(d.n.review ?? 0)}</td>
                    <td>{fmt(d.n.review_done ?? 0)}</td>
                    <td>{fmt(d.n.analysis ?? 0)}</td>
                    <td>{fmt(d.n.photo ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      <footer className="stats-more small muted">
        More: referrers, pages, devices and browsers in{" "}
        <a href="https://vercel.com/clipcontext/whatsthisposition/analytics" target="_blank" rel="noopener">
          Vercel Web Analytics
        </a>
        ; extension installs and weekly users in the{" "}
        <a href="https://chrome.google.com/webstore/devconsole" target="_blank" rel="noopener">
          Chrome Web Store dashboard
        </a>
        .
      </footer>
    </main>
  );
}
