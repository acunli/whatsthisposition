"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Unit } from "@/lib/stats/period";
import { useInBrowser } from "./useInBrowser";

export interface ChartPoint {
  t: number;
  people: number;
  m: Record<string, number>;
}

export interface ChartMetric {
  key: string;
  label: string;
  /** What one of it is called in the tooltip ("people", "visits"). */
  unit: string;
}

/** A metric's value at a point: people, page views (loads + pages opened), minutes visible, or a use's count. */
export function metricValue(p: ChartPoint, key: string): number {
  if (key === "people") return p.people;
  if (key === "views") return (p.m.visit ?? 0) + (p.m.page ?? 0);
  if (key === "minutes") return (p.m.time ?? 0) / 60;
  return p.m[key] ?? 0;
}

const H = 230;
const PAD = { top: 14, right: 14, bottom: 30, left: 42 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p;
}
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : Number.isInteger(n) ? String(n) : n.toFixed(1));
const shown = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en") : n.toLocaleString("en", { maximumFractionDigits: 1 }));

/** A bucket's name: hours in the viewer's own time, days, weeks and months as UTC dates. */
function when(t: number, unit: Unit, long = false): string {
  const d = new Date(t);
  if (unit === "hour") {
    const hour = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return long ? `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}, ${hour}` : hour;
  }
  const utc = { timeZone: "UTC" } as const;
  if (unit === "month") return d.toLocaleDateString("en", { ...utc, month: "short", year: "numeric" });
  const day = d.toLocaleDateString("en", { ...utc, month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}) });
  return unit === "week" ? `Week of ${day}` : day;
}

/**
 * One metric over the period as a line with a soft area, the period before as a grey line on
 * the same axis, a crosshair that snaps to the nearest bucket (pointer or arrow keys), and a
 * table of every value. The metric is picked from the tabs above.
 */
export function TrendChart({
  points,
  prev,
  unit,
  metrics,
  title,
  initial,
  partial,
}: {
  points: ChartPoint[];
  prev?: ChartPoint[];
  unit: Unit;
  metrics: ChartMetric[];
  title: string;
  initial?: string;
  /** The last bucket is still running (it holds counts so far). */
  partial?: boolean;
}) {
  const [key, setKey] = useState(initial ?? metrics[0].key);
  const [hot, setHot] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Hours are labelled in the viewer's time zone, which the server doesn't know: labels wait for the browser.
  const ready = useInBrowser();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const metric = metrics.find((m) => m.key === key) ?? metrics[0];
  const cur = points.map((p) => metricValue(p, metric.key));
  // The period before is aligned bucket by bucket (src/lib/server/dashboard.ts).
  const aligned = prev?.length === points.length ? prev.map((p) => metricValue(p, metric.key)) : null;
  const before = aligned?.some((v) => v > 0) ? aligned : null;
  const max = niceMax(Math.max(0, ...cur, ...(before ?? [])));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const line = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = n > 1 ? `${line(cur)}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 110))));
  const pick = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * iw;
    setHot(Math.max(0, Math.min(n - 1, n <= 1 ? 0 : Math.round((px / iw) * (n - 1)))));
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHot((h) => Math.max(0, Math.min(n - 1, (h ?? (e.key === "ArrowLeft" ? n : -1)) + (e.key === "ArrowLeft" ? -1 : 1))));
  };
  const total = cur.reduce((a, b) => a + b, 0);
  const summed = metric.key !== "people";

  return (
    <div className="st-trend">
      <div className="st-trend-head">
        <div className="st-metrics" role="tablist" aria-label="Metric">
          {metrics.map((m) => (
            <button key={m.key} role="tab" aria-selected={m.key === metric.key} className={m.key === metric.key ? "chip chip-sm chip-on" : "chip chip-sm"} onClick={() => setKey(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {!table ? (
        <figure className="st-chart" ref={box} aria-label={`${title}: ${metric.label}`}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric.label}, ${n} ${unit}s${summed ? `, ${shown(total)} in all` : ""}`} tabIndex={0} onKeyDown={keys} onBlur={() => setHot(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="st-grid" />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="st-tick">
                  {compact(t)}
                </text>
              </g>
            ))}
            {ready &&
              points.map((p, i) =>
                i % every === 0 || i === n - 1 ? (
                  <text key={p.t} x={x(i)} y={H - 9} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="st-tick">
                    {when(p.t, unit)}
                  </text>
                ) : null,
              )}
            {before && <path d={line(before)} className="st-line-prev" />}
            {area && <path d={area} className="st-area" />}
            {n > 1 ? <path d={line(cur)} className="st-line" /> : n === 1 && <circle cx={x(0)} cy={y(cur[0])} r={4} className="st-dot" />}
            {hot !== null && (
              <g>
                <line x1={x(hot)} x2={x(hot)} y1={PAD.top} y2={PAD.top + ih} className="st-cross" />
                {before && before[hot] !== undefined && <circle cx={x(hot)} cy={y(before[hot])} r={4} className="st-dot-prev" />}
                <circle cx={x(hot)} cy={y(cur[hot])} r={4} className="st-dot" />
              </g>
            )}
            <rect x={PAD.left} y={PAD.top} width={iw} height={ih} fill="transparent" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHot(null)} />
          </svg>
          {hot !== null && ready && (
            <div className="st-tip" style={{ left: `${(x(hot) / W) * 100}%`, top: `${PAD.top}px` }} role="status">
              <span>
                <i className="st-key st-key-line" /> <b>{shown(cur[hot])}</b> {metric.unit} · {when(points[hot].t, unit, true)}
                {partial && hot === n - 1 ? " (so far)" : ""}
              </span>
              {before && prev && before[hot] !== undefined && (
                <span className="muted">
                  <i className="st-key st-key-prev" /> <b>{shown(before[hot])}</b> · {when(prev[hot].t, unit, true)}
                </span>
              )}
            </div>
          )}
          {prev && (
            <figcaption className="st-legend small muted">
              <span>
                <i className="st-key st-key-line" /> This period
              </span>
              <span>{before ? <><i className="st-key st-key-prev" /> The period before</> : "Nothing was counted in the period before."}</span>
            </figcaption>
          )}
        </figure>
      ) : (
        <div className="st-table-wrap st-trend-table">
          <table className="st-table">
            <thead>
              <tr>
                <th>{unit === "hour" ? "Hour (your time)" : unit === "day" ? "Day (UTC)" : unit === "week" ? "Week (UTC)" : "Month"}</th>
                <th>{metric.label}</th>
                {before && <th>The period before</th>}
              </tr>
            </thead>
            <tbody>
              {[...points.keys()].reverse().map((i) => (
                <tr key={points[i].t}>
                  <td>{ready ? when(points[i].t, unit, true) : new Date(points[i].t).toISOString().slice(0, 13)}</td>
                  <td>{shown(cur[i])}</td>
                  {before && <td>{before[i] !== undefined ? shown(before[i]) : "–"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
