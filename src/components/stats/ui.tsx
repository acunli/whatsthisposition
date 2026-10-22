/**
 * The dashboard's static pieces (/stats), drawn on the server: bar lists, stat tiles with a
 * sparkline, the share-of-people steps, page-speed cards and plain tables. Values are always
 * printed, so nothing needs hovering to be read; colours come from the --viz-* tokens in
 * src/app/stats/stats.css (validated on the card surface in both themes).
 */
import type { ReactNode } from "react";
import { VITALS, type VitalName } from "@/lib/stats/fields";
import { quantile, ratings, type VitalCounts } from "@/lib/stats/report";

export const fmt = (n: number) => Math.round(n).toLocaleString("en");
export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
export const share = (part: number, whole: number) => (whole ? part / whole : 0);

/** Seconds as "45 s", "3 min 20 s", "1 h 05 min". */
export function duration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0 s";
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${String(Math.round((s - h * 3600) / 60)).padStart(2, "0")} min`;
}

/** A change on the period before: "+12%", "−3%", "new", or nothing to compare with. */
export function delta(now: number, before: number): { text: string; dir: "up" | "down" | "flat" } {
  if (!before) return now ? { text: "new this period", dir: "up" } : { text: "nothing before", dir: "flat" };
  const d = Math.round(((now - before) / before) * 100);
  return { text: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}% on the period before`, dir: d > 0 ? "up" : d < 0 ? "down" : "flat" };
}

export function Section({ id, title, note, children, wide }: { id: string; title: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section id={id} className={wide ? "st-section st-wide" : "st-section"} aria-labelledby={`${id}-h`}>
      <div className="st-section-head">
        <h2 id={`${id}-h`} className="st-h2">
          {title}
        </h2>
        {note && <p className="small muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function Card({ title, note, children, className }: { title?: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `st-card ${className}` : "st-card"}>
      {title && <h3 className="st-h3">{title}</h3>}
      {note && <p className="small muted st-card-note">{note}</p>}
      {children}
    </div>
  );
}

/** A tiny trend line (no axis): the shape of a metric over the period. */
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2 || !values.some((v) => v > 0)) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="st-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" />
    </svg>
  );
}

export function Tile({ label, value, before, note, spark, help }: { label: string; value: string | number; before?: number; note?: ReactNode; spark?: number[]; help?: string }) {
  const n = typeof value === "number" ? value : null;
  const d = n !== null && before !== undefined ? delta(n, before) : null;
  return (
    <div className="st-tile" title={help}>
      <span className="st-tile-label">{label}</span>
      <b className="st-tile-value">{n !== null ? fmt(n) : value}</b>
      {d && <span className={`st-delta st-delta-${d.dir}`}>{d.text}</span>}
      {note && <span className="small muted">{note}</span>}
      {spark && <Spark values={spark} />}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Shown after the value: a share, a rate, a time. */
  extra?: ReactNode;
}

/** Bars from one baseline with the value at the tip; one colour for every bar (the rows are names, not an order). */
export function BarList({ rows, unit, empty = "Nothing counted yet.", tone = "people", total }: { rows: BarRow[]; unit: string; empty?: string; tone?: "people" | "use"; total?: number }) {
  if (!rows.length) return <p className="small muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="st-bars">
      {rows.map((r) => (
        <li key={r.key} title={`${typeof r.label === "string" ? r.label : r.key}: ${fmt(r.value)} ${unit} (${pct(r.value, sum)})`}>
          <span className="st-bar-label">{r.label}</span>
          <span className="st-bar-track">
            <span className={`st-bar st-bar-${tone}`} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </span>
          <span className="st-bar-value">
            <b>{fmt(r.value)}</b> <span className="muted">{pct(r.value, sum)}</span>
            {r.extra !== undefined && <span className="st-bar-extra">{r.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A table with numbers aligned right; the first column is the name. */
export function Table({ head, rows, empty = "Nothing counted yet." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="small muted">{empty}</p>;
  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Of the people who visited, the share who went on to each step (people can skip steps, so it
 * isn't strictly a funnel). A step that only follows another (`of`, its index) also shows its
 * share of that one's people.
 */
export function Steps({ steps }: { steps: { label: string; value: number; of?: number }[] }) {
  const top = steps[0]?.value ?? 0;
  if (!top) return <p className="small muted">Nobody yet.</p>;
  return (
    <ol className="st-steps">
      {steps.map((s) => (
        <li key={s.label}>
          <span className="st-step-label">{s.label}</span>
          <span className="st-bar-track">
            {s.value > 0 && <span className="st-bar st-bar-people" style={{ width: `${Math.max(1.5, share(s.value, top) * 100)}%` }} />}
          </span>
          <span className="st-bar-value">
            <b>{fmt(s.value)}</b> <span className="muted">{pct(s.value, top)}</span>
            {s.of !== undefined && steps[s.of].value > 0 && (
              <span className="st-bar-extra">
                {pct(Math.min(s.value, steps[s.of].value), steps[s.of].value)} of those who {steps[s.of].label.toLowerCase()}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

const VITAL_TITLES: Record<VitalName, string> = {
  LCP: "Largest Contentful Paint",
  INP: "Interaction to Next Paint",
  CLS: "Cumulative Layout Shift",
  FCP: "First Contentful Paint",
  TTFB: "Time to First Byte",
};
const VITAL_NOTES: Record<VitalName, string> = {
  LCP: "when the main content showed",
  INP: "how fast taps and clicks are answered",
  CLS: "how much the page jumps while loading",
  FCP: "when anything first showed",
  TTFB: "how fast the server answered",
};

const vitalValue = (name: VitalName, v: number | null) => (v === null ? "–" : name === "CLS" ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const DEVICE_NAMES: Record<string, string> = { mobile: "Phones", tablet: "Tablets", desktop: "Computers" };

/** One page-speed measurement: its 75th percentile and rating, the share of good / so-so / poor loads, and per device type. */
export function Vital({ name, counts }: { name: VitalName; counts: VitalCounts }) {
  const total = counts.all.reduce((a, b) => a + b, 0);
  const p75 = quantile(counts.all, VITALS[name].bounds);
  const r = ratings(name, counts.all);
  const rating = p75 === null ? null : p75 <= VITALS[name].good ? "good" : p75 > VITALS[name].poor ? "poor" : "fair";
  const RATING = { good: "Good", fair: "Needs improvement", poor: "Poor" } as const;
  return (
    <div className="st-card st-vital">
      <h3 className="st-h3">
        {name} <span className="muted">· {VITAL_TITLES[name]}</span>
      </h3>
      <p className="small muted st-card-note">{VITAL_NOTES[name]}; 75% of loads were at or under:</p>
      <p className="st-vital-value">
        <b>{vitalValue(name, p75)}</b>
        {rating && (
          <span className={`st-status st-status-${rating}`}>
            <span aria-hidden className="st-status-icon">
              {rating === "good" ? "✓" : rating === "fair" ? "!" : "✕"}
            </span>
            {RATING[rating]}
          </span>
        )}
      </p>
      {total > 0 ? (
        <>
          <div className="st-split" role="img" aria-label={`Good ${pct(r.good, total)}, needs improvement ${pct(r.fair, total)}, poor ${pct(r.poor, total)}`}>
            {(["good", "fair", "poor"] as const).map((k) => r[k] > 0 && <span key={k} className={`st-split-${k}`} style={{ flexGrow: r[k] }} title={`${RATING[k]}: ${fmt(r[k])} (${pct(r[k], total)})`} />)}
          </div>
          <p className="small st-split-legend">
            <span>
              <i className="st-key st-split-good" /> Good {pct(r.good, total)}
            </span>
            <span>
              <i className="st-key st-split-fair" /> Needs improvement {pct(r.fair, total)}
            </span>
            <span>
              <i className="st-key st-split-poor" /> Poor {pct(r.poor, total)}
            </span>
          </p>
          <p className="small muted">
            {fmt(total)} page loads
            {Object.entries(counts.byDevice)
              .filter(([, b]) => b.some((x) => x))
              .map(([d, b]) => ` · ${DEVICE_NAMES[d] ?? d} ${vitalValue(name, quantile(b, VITALS[name].bounds))}`)
              .join("")}
          </p>
        </>
      ) : (
        <p className="small muted">No measurements yet.</p>
      )}
    </div>
  );
}
