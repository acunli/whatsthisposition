"use client";

import { useEffect, useRef, useState } from "react";

export interface DailyPoint {
  day: string;
  value: number;
}

const H = 190;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

/** A clean ceiling for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p;
}

const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

/**
 * One series per day as columns (the data-viz rules: thin columns from one baseline, a rounded
 * end, a hairline grid, a tooltip on hover and on keyboard focus). `unit` names the value in the
 * tooltip ("people", "reviews").
 */
export function DailyColumns({ points, color, unit, label }: { points: DailyPoint[]; color: string; unit: string; label: string }) {
  const [hot, setHot] = useState<number | null>(null);
  // Drawn at the width it has (not scaled), so text stays its real size on a phone too.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const band = iw / Math.max(1, points.length);
  const bar = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const labelled = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const h = hot !== null ? points[hot] : null;
  return (
    <figure className="stats-chart" aria-label={label} ref={box}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHot(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stats-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="stats-tick">
              {compact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.left + band * i + band / 2;
          const top = y(p.value);
          const r = Math.min(4, bar / 2, PAD.top + ih - top);
          const x0 = cx - bar / 2;
          const base = PAD.top + ih;
          // Rounded at the data end, square at the baseline.
          const d = p.value > 0 ? `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bar - r}Q${x0 + bar},${top} ${x0 + bar},${top + r}V${base}Z` : "";
          return (
            <g
              key={p.day}
              tabIndex={0}
              role="img"
              aria-label={`${short(p.day)}: ${p.value} ${unit}`}
              onPointerEnter={() => setHot(i)}
              onFocus={() => setHot(i)}
              onBlur={() => setHot(null)}
              className={hot === i ? "stats-col stats-col-on" : "stats-col"}
            >
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent" />
              {d && <path d={d} fill={color} />}
              {labelled.has(i) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="stats-tick">
                  {short(p.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hot !== null && (
        <div className="stats-tip" style={{ left: `${((PAD.left + band * hot + band / 2) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }} role="status">
          <b>{h.value.toLocaleString("en")}</b> {unit}
          <span>{short(h.day)}</span>
        </div>
      )}
    </figure>
  );
}
