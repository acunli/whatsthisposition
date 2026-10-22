"use client";

import { useEffect, useRef, useState } from "react";

export interface Column {
  key: string;
  /** The axis label (only some are drawn), and the tooltip's name for it. */
  label: string;
  title: string;
  value: number;
}

const H = 170;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

/** A clean ceiling for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

/**
 * One series as columns (the data-viz rules: thin columns from one baseline, a rounded end, a
 * hairline grid, a tooltip on hover and on keyboard focus). `unit` names the value in the tooltip.
 */
export function Columns({ columns, unit, label, tone = "people", labelEvery }: { columns: Column[]; unit: string; label: string; tone?: "people" | "use"; labelEvery?: number }) {
  const [hot, setHot] = useState<number | null>(null);
  // Drawn at the width it has (not scaled), so text stays its real size on a phone too.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const band = iw / Math.max(1, columns.length);
  const bar = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const every = labelEvery ?? Math.max(1, Math.ceil(columns.length / Math.max(2, Math.floor(iw / 64))));
  const h = hot !== null ? columns[hot] : null;
  return (
    <figure className="st-chart" aria-label={label} ref={box}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHot(null)}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="st-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="st-tick">
              {compact(t)}
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          const cx = PAD.left + band * i + band / 2;
          const top = y(c.value);
          const r = Math.min(4, bar / 2, PAD.top + ih - top);
          const x0 = cx - bar / 2;
          const base = PAD.top + ih;
          // Rounded at the data end, square at the baseline.
          const d = c.value > 0 ? `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bar - r}Q${x0 + bar},${top} ${x0 + bar},${top + r}V${base}Z` : "";
          return (
            <g
              key={c.key}
              tabIndex={0}
              role="img"
              aria-label={`${c.title}: ${c.value.toLocaleString("en")} ${unit}`}
              onPointerEnter={() => setHot(i)}
              onFocus={() => setHot(i)}
              onBlur={() => setHot(null)}
              className={hot === i ? "st-col st-col-on" : "st-col"}
            >
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent" />
              {d && <path d={d} className={`st-fill-${tone}`} />}
              {(i % every === 0 || i === columns.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="st-tick">
                  {c.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hot !== null && (
        <div className="st-tip st-tip-col" style={{ left: `${((PAD.left + band * hot + band / 2) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }} role="status">
          <span>
            <b>{h.value.toLocaleString("en")}</b> {unit}
          </span>
          <span className="muted">{h.title}</span>
        </div>
      )}
    </figure>
  );
}
