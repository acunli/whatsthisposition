"use client";

import { useMemo, useState } from "react";
import { useInBrowser } from "./useInBrowser";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourName = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Visits by weekday and hour in the viewer's own time zone (the counts are kept per UTC hour, so
 * they're placed here, in the browser). One hue, darker for more; every cell has a tooltip.
 */
export function WeekHeatmap({ hourly, unit = "visits" }: { hourly: { t: number; visits: number }[]; unit?: string }) {
  const [hot, setHot] = useState<[number, number] | null>(null);
  const inBrowser = useInBrowser();
  const grid = useMemo(() => {
    if (!inBrowser) return null;
    const g = DAYS.map(() => Array(24).fill(0) as number[]);
    for (const { t, visits } of hourly) {
      const d = new Date(t);
      g[(d.getDay() + 6) % 7][d.getHours()] += visits;
    }
    return g;
  }, [inBrowser, hourly]);
  const zone = inBrowser ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  if (!grid) return <div className="st-heat st-heat-wait" aria-hidden />;
  const max = Math.max(0, ...grid.flat());
  if (!max) return <p className="small muted">No hourly counts in this period yet (they start on 2026-10-22).</p>;
  let peak: [number, number] = [0, 0];
  grid.forEach((row, d) => row.forEach((v, h) => v > grid[peak[0]][peak[1]] && (peak = [d, h])));
  const byDay = grid.map((r) => r.reduce((a, b) => a + b, 0));
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((a, r) => a + r[h], 0));
  const topHour = byHour.indexOf(Math.max(...byHour));
  const topDay = byDay.indexOf(Math.max(...byDay));
  return (
    <div className="st-heatbox">
      <p className="small muted">
        Busiest hour: <b className="st-ink">{DAYS[peak[0]]} {hourName(peak[1])}</b> ({grid[peak[0]][peak[1]].toLocaleString("en")} {unit}). Busiest day: <b className="st-ink">{DAYS[topDay]}</b>; busiest time of day: <b className="st-ink">{hourName(topHour)}</b>. Your time ({zone}).
      </p>
      <div className="st-heat" role="grid" aria-label={`${unit} by weekday and hour, your time`} onPointerLeave={() => setHot(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="st-heat-h" aria-hidden>
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
        {grid.map((row, d) => [
          <span key={`d${d}`} className="st-heat-d">
            {DAYS[d]}
          </span>,
          ...row.map((v, h) => (
            <span
              key={`${d}-${h}`}
              role="gridcell"
              tabIndex={0}
              aria-label={`${DAYS[d]} ${hourName(h)}: ${v} ${unit}`}
              className={hot && hot[0] === d && hot[1] === h ? "st-cell st-cell-on" : "st-cell"}
              style={v ? { background: `color-mix(in srgb, var(--viz-1) ${Math.round(12 + (v / max) * 88)}%, var(--st-cell-0))` } : undefined}
              onPointerEnter={() => setHot([d, h])}
              onFocus={() => setHot([d, h])}
              onBlur={() => setHot(null)}
            />
          )),
        ])}
      </div>
      <div className="st-heat-foot small muted">
        <span>{hot ? `${DAYS[hot[0]]} ${hourName(hot[1])}–${hourName((hot[1] + 1) % 24)}: ${grid[hot[0]][hot[1]].toLocaleString("en")} ${unit}` : "Point at a cell for its count."}</span>
        <span className="st-scale" aria-hidden>
          Fewer <i /> More
        </span>
      </div>
    </div>
  );
}
