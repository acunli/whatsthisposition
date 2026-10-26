/**
 * The owner's usage dashboard: who uses the site, when, from where, on what, and how fast it
 * is for them. Signed in with STATS_PASSWORD (src/proxy.ts, checked again here). Numbers come
 * from the anonymous counter (src/lib/server/usage.ts) through src/lib/server/dashboard.ts;
 * three views: the period overview, retention within a month, and live.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Columns } from "@/components/stats/Columns";
import { LiveView } from "@/components/stats/LiveView";
import { TrendChart, type ChartMetric } from "@/components/stats/TrendChart";
import { WeekHeatmap } from "@/components/stats/WeekHeatmap";
import { BarList, Card, Section, Steps, Table, Tile, Vital, duration, fmt, pct, type BarRow } from "@/components/stats/ui";
import { readDashboard, type Dashboard } from "@/lib/server/dashboard";
import { statsAllowed } from "@/lib/server/statsAuth";
import { COUNTING_SINCE, HOURLY_SINCE, keyPrefix, readLive, readRetention, usageStore, utcDay, type Live, type Retention } from "@/lib/server/usage";
import { REVIEW_SECONDS, VITAL_NAMES } from "@/lib/stats/fields";
import { CHANNEL_NAMES, TECH_TITLES, countryName, flag, languageName, pageName, sourceName, techValue } from "@/lib/stats/labels";
import { RANGES, periodOf, type Period, type Unit } from "@/lib/stats/period";
import { quantile, ranked, type Breakdown, type Counts } from "@/lib/stats/report";
import "./stats.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage", robots: { index: false, follow: false } };

type Query = Record<string, string | undefined>;
type View = "overview" | "retention" | "live";

/** A dashboard address with some settings changed. */
function href(q: Query, change: Query): string {
  const next = { ...q, ...change };
  const params = new URLSearchParams();
  for (const k of ["view", "range", "from", "to", "unit", "month"]) if (next[k]) params.set(k, next[k]!);
  const s = params.toString();
  return s ? `/stats?${s}` : "/stats";
}

/** The CSV of the period on screen (src/app/stats/export). */
function exportHref(q: Query, kind?: string): string {
  const params = new URLSearchParams();
  for (const k of ["range", "from", "to", "unit"]) if (q[k]) params.set(k, q[k]!);
  if (kind) params.set("kind", kind);
  return `/stats/export?${params}`;
}

const TREND_METRICS: ChartMetric[] = [
  { key: "people", label: "People", unit: "people" },
  { key: "visit", label: "Visits", unit: "visits" },
  { key: "views", label: "Page views", unit: "page views" },
  { key: "review", label: "Reviews started", unit: "reviews" },
  { key: "review_done", label: "Reviews finished", unit: "reviews finished" },
  { key: "analysis", label: "Analyses", unit: "analyses" },
  { key: "lookup", label: "Game lists", unit: "game lists" },
  { key: "share", label: "Shares", unit: "shares" },
  { key: "get_extension", label: "Add to Chrome", unit: "clicks" },
  { key: "minutes", label: "Minutes on the site", unit: "minutes" },
  { key: "new", label: "New people", unit: "new people" },
  { key: "back", label: "Returning people", unit: "returning people" },
  { key: "error", label: "Errors", unit: "errors" },
];

const UNIT_NAMES: Record<Unit, string> = { hour: "Hours", day: "Days", week: "Weeks", month: "Months" };
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const rows = (c: Counts, name: (k: string) => ReactNode, top = 10): BarRow[] => ranked(c, top).map((r) => ({ key: r.key, label: r.key === "Other" ? "Other" : name(r.key), value: r.value }));
const sum = (c: Counts | undefined) => Object.values(c ?? {}).reduce((a, b) => a + b, 0);

function Controls({ q, period, view, today }: { q: Query; period: Period; view: View; today: string }) {
  return (
    <div className="st-controls">
      <nav className="st-views" aria-label="View">
        {(
          [
            ["overview", "Overview"],
            ["retention", "Retention"],
            ["live", "Live"],
          ] as const
        ).map(([v, label]) => (
          <Link key={v} href={href(q, { view: v === "overview" ? undefined : v })} className={v === view ? "st-view st-view-on" : "st-view"} aria-current={v === view ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {view === "overview" && (
        <div className="st-filters">
          <nav className="st-ranges" aria-label="Period">
            {RANGES.map((r) => (
              <Link key={r.key} href={href({}, { range: r.key })} className={r.key === period.key ? "chip chip-sm chip-on" : "chip chip-sm"} aria-current={r.key === period.key ? "page" : undefined}>
                {r.key === "all" ? r.label : `Last ${r.label}`}
              </Link>
            ))}
          </nav>
          <form className="st-custom" action="/stats" method="get">
            <input type="hidden" name="range" value="custom" />
            <label>
              <span className="small muted">From</span>
              <input className="input input-sm" type="date" name="from" min={COUNTING_SINCE} max={today} defaultValue={period.key === "custom" ? period.from : (period.days[0] ?? today)} />
            </label>
            <label>
              <span className="small muted">to</span>
              <input className="input input-sm" type="date" name="to" min={COUNTING_SINCE} max={today} defaultValue={period.key === "custom" ? period.to : today} />
            </label>
            <button className={period.key === "custom" ? "chip chip-sm chip-on" : "chip chip-sm"} type="submit">
              Show
            </button>
          </form>
          {period.units.length > 1 && (
            <nav className="st-units" aria-label="Chart unit">
              {period.units.map((u) => (
                <Link key={u} href={href(q, { unit: u })} className={u === period.unit ? "chip chip-sm chip-on" : "chip chip-sm"} aria-current={u === period.unit ? "true" : undefined}>
                  {UNIT_NAMES[u]}
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function Overview({ d, q }: { d: Dashboard; q: Query }) {
  const t = d.totals;
  const p = d.prev;
  const e = t.events;
  const views = (b: Breakdown) => (b.events.visit ?? 0) + (b.events.page ?? 0);
  const spark = (key: string) => d.points.map((pt) => (key === "people" ? pt.people : key === "views" ? (pt.m.visit ?? 0) + (pt.m.page ?? 0) : (pt.m[key] ?? 0)));
  const visits = e.visit ?? 0;
  const people = d.people;
  const firstUses = t.returning.new + t.returning.back;
  const reviewStarts = e.review ?? 0;
  const reviewSecs = Object.values(t.reviewTime).reduce((a, r) => a + r.seconds, 0);
  const reviewTimed = Object.values(t.reviewTime).reduce((a, r) => a + r.count, 0);
  const allReviewBuckets = Object.values(t.reviewTime).reduce((acc, r) => acc.map((x, i) => x + r.buckets[i]), Array(REVIEW_SECONDS.length + 1).fill(0) as number[]);
  const periodNote = d.period.rolling ? "hours ending now" : `${d.period.days[0] ?? d.period.from} to ${d.period.days.at(-1) ?? d.period.to} (UTC days)`;

  const channels = Object.entries(t.channels)
    .map(([c, n]) => ({ c, n }))
    .sort((a, b) => (b.n.visit ?? 0) - (a.n.visit ?? 0) || sum(b.n) - sum(a.n));
  const pages = Object.entries(t.pages)
    .map(([page, n]) => ({ page, n }))
    .filter((r) => r.n.views || r.n.time)
    .sort((a, b) => (b.n.views ?? 0) - (a.n.views ?? 0));
  const snaps = d.snapshots;
  const last = snaps.at(-1);

  return (
    <>
      <nav className="st-toc" aria-label="Sections">
        {[
          ["summary", "Summary"],
          ["trends", "Trends"],
          ["when", "When"],
          ["journey", "Journey"],
          ["sources", "Sources"],
          ["pages", "Pages"],
          ["places", "Places"],
          ["devices", "Devices"],
          ["features", "Features"],
          ["speed", "Speed"],
          ["growth", "Growth"],
          ["data", "Data"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <Section id="summary" title={d.period.label} note={`${periodNote}, compared with the same length just before.`}>
        <div className="st-hero">
          <span className="st-tile-label">People</span>
          <b className="st-hero-value">{fmt(people)}</b>
          <span className={`st-delta st-delta-${!d.prevPeople ? "flat" : people >= d.prevPeople ? "up" : "down"}`}>
            {d.prevPeople ? `${people >= d.prevPeople ? "+" : "−"}${Math.abs(Math.round(((people - d.prevPeople) / d.prevPeople) * 100))}% on the period before (${fmt(d.prevPeople)})` : "nothing to compare with yet"}
          </span>
          <span className="small muted">Distinct people, estimated within about 1%. Someone is recognised within a calendar month (UTC), so a period spanning two months can count a person twice; before {HOURLY_SINCE}, within a day.</span>
        </div>
        <div className="st-tiles">
          <Tile label="Visits" value={visits} before={p.events.visit ?? 0} spark={spark("visit")} help="Page loads (not counting pages opened within the site)." />
          <Tile label="Page views" value={views(t)} before={views(p)} spark={spark("views")} />
          <Tile label="Pages per visit" value={visits ? (views(t) / visits).toFixed(2) : "–"} />
          <Tile label="Time per visit" value={visits ? duration(t.time / visits) : "–"} note={`${duration(t.time)} in all, while the page was visible`} />
          <Tile label="People who did something" value={d.engaged} note={`${pct(d.engaged, people)} of people; the rest only opened pages`} />
          <Tile label="New people" value={d.newcomers} note={`first seen this month during the period; counted from ${HOURLY_SINCE}`} spark={spark("new")} />
          <Tile
            label="Returning people"
            value={Math.max(0, d.tracked - d.newcomers)}
            note={`back from an earlier day of the month${d.tracked < people ? ` (of the ${fmt(d.tracked)} people since ${HOURLY_SINCE})` : ""}${firstUses ? `; ${pct(t.returning.back, firstUses)} of people's days were returns` : ""}`}
            spark={spark("back")}
          />
          <Tile label="Reviews started" value={reviewStarts} before={p.events.review ?? 0} note={`by ${fmt(d.who.review ?? 0)} people`} spark={spark("review")} />
          <Tile label="Reviews finished" value={e.review_done ?? 0} before={p.events.review_done ?? 0} note={reviewTimed ? `average ${duration(reviewSecs / reviewTimed)}` : `${pct(e.review_done ?? 0, reviewStarts)} of reviews started`} spark={spark("review_done")} />
          <Tile label="Positions analysed" value={e.analysis ?? 0} before={p.events.analysis ?? 0} note={`by ${fmt(d.who.analysis ?? 0)} people`} spark={spark("analysis")} />
          <Tile label="Game lists fetched" value={e.lookup ?? 0} before={p.events.lookup ?? 0} note={`counted from ${HOURLY_SINCE}`} />
          <Tile label="Photos read" value={e.photo ?? 0} before={p.events.photo ?? 0} />
          <Tile label="Side lines tried" value={e.side_line ?? 0} before={p.events.side_line ?? 0} />
          <Tile label="Reviews shared" value={e.share ?? 0} before={p.events.share ?? 0} note={`by ${fmt(d.who.share ?? 0)} people`} />
          <Tile label="Add to Chrome clicks" value={e.get_extension ?? 0} before={p.events.get_extension ?? 0} note={`by ${fmt(d.who.get_extension ?? 0)} people`} />
          <Tile label="Visits from the extension" value={t.sources.visit?.extension ?? 0} before={p.sources.visit?.extension ?? 0} />
          <Tile label="Errors" value={e.error ?? 0} before={p.events.error ?? 0} note={`and ${fmt(e.import_error ?? 0)} games that couldn't be brought in`} />
        </div>
      </Section>

      <Section id="trends" title="Trends" note={d.period.unit === "hour" ? "Per hour, in your time zone. The grey line is the period before." : `Per ${d.period.unit} (UTC). The grey line is the period before.`}>
        <Card>
          <TrendChart points={d.points} prev={d.prevPoints} unit={d.period.unit} metrics={TREND_METRICS} title="Trends" partial={d.period.rolling || d.period.days.at(-1) === utcDay(d.now)} />
        </Card>
      </Section>

      <Section id="when" title="When people come">
        <div className="st-grid-2">
          <Card title="Visits by weekday and hour" note="In your time zone.">
            <WeekHeatmap hourly={d.hourly} />
          </Card>
          <Card title="By the visitor's own clock" note="The hour where the visitor was (from their IP's time zone), for every visit.">
            <Columns columns={t.localHours.map((v, h) => ({ key: String(h), label: String(h).padStart(2, "0"), title: `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00 their time`, value: v }))} unit="visits" label="Visits by the visitor's local hour" labelEvery={3} />
            <BarList rows={DAYS_OF_WEEK.filter((x) => t.localDays[x]).map((x) => ({ key: x, label: x, value: t.localDays[x] }))} unit="visits" empty="No local times yet." />
          </Card>
        </div>
      </Section>

      <Section id="journey" title="What people go on to do" note="Of the people who visited, how many did each thing (people can skip a step: a pasted PGN needs no game list).">
        <Card>
          <Steps
            steps={[
              { label: "Visited", value: d.who.visit ?? people },
              { label: "Fetched a game list", value: d.who.lookup ?? 0 },
              { label: "Started a review", value: d.who.review ?? 0 },
              { label: "Finished a review", value: d.who.review_done ?? 0, of: 2 },
              { label: "Tried a side line", value: d.who.side_line ?? 0, of: 3 },
              { label: "Shared a review", value: d.who.share ?? 0, of: 3 },
            ]}
          />
          <Steps
            steps={[
              { label: "Visited", value: d.who.visit ?? people },
              { label: "Analysed a position", value: d.who.analysis ?? 0 },
              { label: "Read a photo", value: d.who.photo ?? 0 },
              { label: "Clicked Add to Chrome", value: d.who.get_extension ?? 0 },
            ]}
          />
        </Card>
      </Section>

      <Section id="sources" title="Where visitors come from" note="The channel is read from the link's ?ref= / utm_source= tag or the referring site's name (never its address).">
        <Card>
          <Table
            head={["Channel", "Visits", "Reviews", "Per 100 visits", "Analyses", "Add to Chrome"]}
            rows={channels.map(({ c, n }) => [CHANNEL_NAMES[c] ?? c, fmt(n.visit ?? 0), fmt(n.review ?? 0), n.visit ? fmt(((n.review ?? 0) / n.visit) * 100) : "–", fmt(n.analysis ?? 0), fmt(n.get_extension ?? 0)])}
            empty="No channels counted yet (counted from 2026-10-19)."
          />
        </Card>
        <div className="st-grid-3">
          <Card title="How visits start">
            <BarList rows={rows(t.sources.visit ?? {}, (s) => sourceName("visit", s))} unit="visits" />
          </Card>
          <Card title="Where reviews come from">
            <BarList rows={rows(t.sources.review ?? {}, (s) => sourceName("review", s))} unit="reviews" tone="use" />
          </Card>
          <Card title="How analyses start">
            <BarList rows={rows(t.sources.analysis ?? {}, (s) => sourceName("analysis", s))} unit="analyses" tone="use" />
          </Card>
          <Card title="Game lists fetched">
            <BarList rows={rows(t.sources.lookup ?? {}, (s) => sourceName("lookup", s))} unit="lists" tone="use" empty={`Counted from ${HOURLY_SINCE}.`} />
          </Card>
          <Card title="Games that couldn't be brought in">
            <BarList rows={rows(t.sources.import_error ?? {}, (s) => sourceName("import_error", s))} unit="failures" tone="use" empty="None." />
          </Card>
          <Card title="Add to Chrome, by place">
            <BarList rows={rows(t.sources.get_extension ?? {}, (s) => sourceName("get_extension", s))} unit="clicks" tone="use" />
          </Card>
        </div>
      </Section>

      <Section id="pages" title="Pages" note={`Views count page loads and pages opened within the site; landings are the page a visit started on. Counted by page from ${HOURLY_SINCE}.`}>
        <Card>
          <Table
            head={["Page", "Views", "Landings", "Average time", "Reviews started", "Analyses"]}
            rows={pages.map(({ page, n }) => [pageName(page), fmt(n.views ?? 0), fmt(n.visit ?? 0), n.views ? duration((n.time ?? 0) / n.views) : "–", fmt(n.review ?? 0), fmt(n.analysis ?? 0)])}
            empty={`Counted from ${HOURLY_SINCE}.`}
          />
        </Card>
      </Section>

      <Section id="places" title="Places" note="From the visitor's IP address as the host reports it; the address itself is never kept.">
        <div className="st-grid-2">
          <Card title="Countries (visits)">
            <BarList rows={rows(t.countries, (c) => `${flag(c)} ${countryName(c)}`, 15)} unit="visits" />
          </Card>
          <Card title="Cities (visits)">
            <BarList
              rows={rows(
                t.cities,
                (k) => {
                  const [c, city] = k.split("|");
                  return `${flag(c)} ${city}`;
                },
                15,
              )}
              unit="visits"
              empty={`Counted from ${HOURLY_SINCE}.`}
            />
          </Card>
          <Card title="Regions (visits)">
            <BarList
              rows={rows(t.regions, (k) => {
                const [c, r] = k.split("|");
                return `${flag(c)} ${countryName(c)} · ${r}`;
              })}
              unit="visits"
              empty={`Counted from ${HOURLY_SINCE}.`}
            />
          </Card>
          <Card title="Languages (the browser's first choice)">
            <BarList rows={rows(t.languages, languageName)} unit="visits" empty={`Counted from ${HOURLY_SINCE}.`} />
          </Card>
        </div>
      </Section>

      <Section id="devices" title="Devices" note={`What each visit was opened on. Counted from ${HOURLY_SINCE}.`}>
        <div className="st-grid-3">
          {Object.keys(TECH_TITLES).map((dim) => (
            <Card key={dim} title={TECH_TITLES[dim]}>
              <BarList rows={rows(t.tech[dim] ?? {}, (v) => techValue(dim, v), 8)} unit="visits" />
            </Card>
          ))}
        </div>
      </Section>

      <Section id="features" title="Features">
        <div className="st-grid-2">
          <Card title="How long reviews take" note="From the start to the finished review, on the visitor's device.">
            <Table
              head={["Depth", "Finished", "Average", "Median", "90% under"]}
              rows={Object.entries(t.reviewTime).map(([depth, r]) => [sourceName("review_done", depth), fmt(r.count), r.count ? duration(r.seconds / r.count) : "–", duration(quantile(r.buckets, REVIEW_SECONDS, 0.5) ?? 0), duration(quantile(r.buckets, REVIEW_SECONDS, 0.9) ?? 0)])}
              empty={`Counted from ${HOURLY_SINCE}.`}
            />
            {reviewTimed > 0 && (
              <Columns
                columns={allReviewBuckets.map((v, i) => {
                  const lo = i ? REVIEW_SECONDS[i - 1] : 0;
                  const name = i < REVIEW_SECONDS.length ? `${lo}–${REVIEW_SECONDS[i]} s` : `over ${lo} s`;
                  return { key: String(i), label: i < REVIEW_SECONDS.length ? `${REVIEW_SECONDS[i]}s` : `${lo}+`, title: name, value: v };
                })}
                unit="reviews"
                label="Finished reviews by how long they took"
                tone="use"
                labelEvery={1}
              />
            )}
          </Card>
          <Card title="Finished reviews, by depth">
            <BarList rows={rows(t.sources.review_done ?? {}, (s) => sourceName("review_done", s))} unit="reviews" tone="use" empty={`Counted by depth from ${HOURLY_SINCE}.`} />
            <h3 className="st-h3 st-gap">Photo reader</h3>
            <BarList rows={rows(t.sources.photo ?? {}, (s) => sourceName("photo", s))} unit="photos" tone="use" empty="No photos read." />
            <h3 className="st-h3 st-gap">Settings changed</h3>
            <BarList rows={rows(t.sources.act ?? {}, (s) => sourceName("act", s))} unit="changes" tone="use" empty="None." />
            <h3 className="st-h3 st-gap">Errors</h3>
            <BarList rows={rows(t.sources.error ?? {}, (s) => sourceName("error", s))} unit="errors" tone="use" empty="None." />
            <h3 className="st-h3 st-gap">Where errors happened</h3>
            <BarList
              rows={rows(
                Object.fromEntries(Object.entries(t.errorsAt).flatMap(([s, at]) => Object.entries(at).map(([where, n]) => [`${s}|${where}`, n]))),
                (k) => {
                  const [s, where] = k.split("|");
                  return (
                    <>
                      {sourceName("error", s)} · <span className="mono">{where}</span>
                    </>
                  );
                },
              )}
              unit="errors"
              tone="use"
              empty="Counted from 2026-10-26: the kind of error and the line of the site's scripts it came from."
            />
          </Card>
        </div>
      </Section>

      <Section id="speed" title="Speed" note={`Web Vitals from visitors' browsers, one set per page load (Safari and Firefox report fewer of them). Counted from ${HOURLY_SINCE}.`}>
        <div className="st-grid-3">
          {VITAL_NAMES.map((v) => (
            <Vital key={v} name={v} counts={t.vitals[v]} />
          ))}
        </div>
      </Section>

      <Section id="growth" title="Growth outside the site" note="Read once a day: the extension's public Chrome Web Store page and the GitHub repository. Not limited to the period.">
        <div className="st-tiles">
          <Tile label="Extension users" value={last?.store?.users ?? "–"} note={last?.store ? `${last.store.rating ?? "–"} out of 5 from ${fmt(last.store.ratings ?? 0)} ratings` : "after the first daily read"} spark={snaps.map((s) => s.store?.users ?? 0)} />
          <Tile label="GitHub stars" value={last?.github?.stars ?? "–"} note={last?.github ? `${fmt(last.github.forks)} forks · ${fmt(last.github.watchers)} watching · ${fmt(last.github.issues)} open issues` : undefined} spark={snaps.map((s) => s.github?.stars ?? 0)} />
          <Tile label="Reviewed games published" value={last?.games ?? "–"} spark={snaps.map((s) => s.games ?? 0)} />
        </div>
        {snaps.length > 1 && (
          <Card>
            <TrendChart
              points={snaps.map((s) => ({ t: Date.parse(`${s.day}T00:00:00Z`), people: 0, m: { users: s.store?.users ?? 0, ratings: s.store?.ratings ?? 0, stars: s.github?.stars ?? 0, games: s.games ?? 0 } }))}
              unit="day"
              metrics={[
                { key: "users", label: "Extension users", unit: "users" },
                { key: "ratings", label: "Store ratings", unit: "ratings" },
                { key: "stars", label: "GitHub stars", unit: "stars" },
                { key: "games", label: "Reviewed games", unit: "games" },
              ]}
              title="Growth outside the site"
            />
          </Card>
        )}
      </Section>

      <Section id="data" title="Data">
        <Card>
          <p className="small">
            Download this period as CSV:{" "}
            <a className="st-link" href={exportHref(q)}>
              one row per {d.period.unit}
            </a>{" "}
            ·{" "}
            <a className="st-link" href={exportHref(q, "counts")}>
              every count, field by field
            </a>
            .
          </p>
          <p className="small muted">
            More: referrers, pages and devices in{" "}
            <a className="st-link" href="https://vercel.com/clipcontext/whatsthisposition/analytics" target="_blank" rel="noopener">
              Vercel Web Analytics
            </a>
            ; installs, uninstalls and weekly users in the{" "}
            <a className="st-link" href="https://chrome.google.com/webstore/devconsole" target="_blank" rel="noopener">
              Chrome Web Store dashboard
            </a>
            ; searches in{" "}
            <a className="st-link" href="https://search.google.com/search-console?resource_id=sc-domain:whatsthisposition.com" target="_blank" rel="noopener">
              Google Search Console
            </a>
            .
          </p>
        </Card>
      </Section>
    </>
  );
}

function RetentionView({ r, q, today }: { r: Retention; q: Query; today: string }) {
  const months: string[] = [];
  for (let m = HOURLY_SINCE.slice(0, 7); m <= today.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const dau = r.daily.length ? r.daily.reduce((a, d) => a + d.people, 0) / r.daily.length : 0;
  const cohortPeople = r.cohorts.reduce((a, c) => a + c.size, 0);
  const cameBack = r.cohorts.reduce((a, c) => a + (c.later ?? 0), 0);
  const cell = (n: number | null, of: number) => {
    if (n === null) return <span className="muted">·</span>;
    const s = of ? n / of : 0;
    return (
      <span className="st-ret" style={{ background: s ? `color-mix(in srgb, var(--viz-1) ${Math.round(10 + s * 70)}%, transparent)` : undefined }} title={`${n} of ${of}`}>
        {of ? `${Math.round(s * 100)}%` : "–"}
      </span>
    );
  };
  return (
    <>
      <nav className="st-ranges" aria-label="Month">
        {months.map((m) => (
          <Link key={m} href={href(q, { view: "retention", month: m })} className={m === r.month ? "chip chip-sm chip-on" : "chip chip-sm"}>
            {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}
          </Link>
        ))}
      </nav>
      <Section id="ret" title="Who comes back" note={`Within one calendar month (UTC): a person is recognised by a code that changes every month. Counted from ${HOURLY_SINCE}.`}>
        <div className="st-tiles">
          <Tile label="People this month" value={r.people} help="Monthly active people (MAU)." />
          <Tile label="People per day (average)" value={dau ? dau.toFixed(1) : "–"} help="Daily active people (DAU)." />
          <Tile label="Stickiness" value={r.people ? pct(dau, r.people) : "–"} note="average people per day ÷ people this month" />
          <Tile label="New people who came back" value={cameBack} note={cohortPeople ? `${pct(cameBack, cohortPeople)} of ${fmt(cohortPeople)} new people returned on a later day` : undefined} />
        </div>
        <Card title="People per day">
          <Columns columns={r.daily.map((x) => ({ key: x.day, label: x.day.slice(8), title: x.day, value: x.people }))} unit="people" label="People per day this month" />
        </Card>
        <Card title="Returns by the day people were first seen" note="Each row: the people first seen that day (this month), and the share of them active again 1–7 days later, and on any later day of the month.">
          <Table
            head={["First seen", "People", "+1 day", "+2", "+3", "+4", "+5", "+6", "+7", "Any later day"]}
            rows={r.cohorts.map((c) => [c.day, fmt(c.size), ...c.back.map((b) => cell(b, c.size)), cell(c.later, c.size)])}
            empty="No days counted yet in this month."
          />
        </Card>
      </Section>
    </>
  );
}

/** What the view needs, read outside rendering (so a database failure becomes a message, not a crash). */
type Loaded = { kind: "none" } | { kind: "error" } | { kind: "live"; live: Live } | { kind: "retention"; r: Retention } | { kind: "overview"; d: Dashboard };

async function load(view: View, period: Period, month: string, now: number): Promise<Loaded> {
  const db = usageStore();
  if (!db) return { kind: "none" };
  try {
    if (view === "live") return { kind: "live", live: await readLive(db, keyPrefix(), now) };
    if (view === "retention") return { kind: "retention", r: await readRetention(db, keyPrefix(), month, utcDay(now)) };
    return { kind: "overview", d: await readDashboard(db, keyPrefix(), period, now) };
  } catch {
    return { kind: "error" };
  }
}

/** The moment the page is drawn (read once per request). */
const requestTime = () => Date.now();

export default async function StatsPage({ searchParams }: { searchParams: Promise<Query> }) {
  if (!statsAllowed((await headers()).get("authorization"))) notFound();
  const q = await searchParams;
  const view: View = q.view === "live" ? "live" : q.view === "retention" ? "retention" : "overview";
  const now = requestTime();
  const today = utcDay(now);
  const period = periodOf(q, now, COUNTING_SINCE);
  const month = q.month && /^\d{4}-\d{2}$/.test(q.month) && q.month <= today.slice(0, 7) ? q.month : today.slice(0, 7);
  const data = await load(view, period, month, now);
  const env = process.env.VERCEL_ENV ?? "local";

  return (
    <main className="st">
      <header className="st-head">
        <div>
          <p className="eyebrow">Usage</p>
          <h1 className="st-title">Who&apos;s using it</h1>
          <p className="small muted">
            Counted anonymously, per UTC hour: no cookies, and no IP addresses or identifiers are stored.
            {env !== "production" && ` These are ${env} numbers, kept apart from the real ones.`}
          </p>
        </div>
      </header>
      <Controls q={q} period={period} view={view} today={today} />
      {data.kind === "none" && <p className="notice">The usage database isn&apos;t connected here (KV_REST_API_URL and KV_REST_API_TOKEN), so nothing is counted.</p>}
      {data.kind === "error" && <p className="notice notice-error">The usage database didn&apos;t answer. Try again in a minute.</p>}
      {data.kind === "live" && <LiveView initial={data.live} />}
      {data.kind === "retention" && <RetentionView r={data.r} q={q} today={today} />}
      {data.kind === "overview" && <Overview d={data.d} q={q} />}
    </main>
  );
}
