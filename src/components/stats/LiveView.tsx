"use client";

import { useCallback, useEffect, useState } from "react";
import { breakdown, ranked } from "@/lib/stats/report";
import { EVENT_NAMES, countryName, flag, pageName, techValue } from "@/lib/stats/labels";
import type { Live } from "@/lib/server/usage";
import { Columns } from "./Columns";

const EVERY = 30_000;

/**
 * Who's on the site right now: people active in the last 5, 30 and 60 minutes, per minute over
 * the last half hour, and this hour's pages, places and uses. Refreshed every 30 seconds while
 * the tab is visible (each refresh is a few dozen database commands, so it pauses when hidden).
 */
export function LiveView({ initial }: { initial: Live | null }) {
  const [live, setLive] = useState<Live | null>(initial);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/stats/live", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; live?: Live };
      if (data.ok && data.live) {
        setLive(data.live);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      if (timer) clearInterval(timer);
      timer = document.visibilityState === "visible" ? setInterval(load, EVERY) : null;
      if (document.visibilityState === "visible") void load();
    };
    timer = setInterval(load, EVERY);
    document.addEventListener("visibilitychange", run);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [load]);
  if (!live) return <p className="notice">{failed ? "The usage database didn't answer." : "Loading…"}</p>;
  const b = breakdown(live.fields);
  const at = new Date(live.at);
  const list = (rows: { key: string; value: number }[], name: (k: string) => string) =>
    rows.length ? (
      <ul className="st-live-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span>{name(r.key)}</span>
            <b>{r.value.toLocaleString("en")}</b>
          </li>
        ))}
      </ul>
    ) : (
      <p className="small muted">Nothing yet.</p>
    );
  const pages = Object.fromEntries(Object.entries(b.pages).map(([p, c]) => [p, c.views ?? 0]));
  const uses = Object.fromEntries(Object.entries(b.events).filter(([e]) => e !== "visit" && e !== "page" && e !== "arrive"));
  return (
    <div className="st-live" aria-live="polite">
      <div className="st-live-head">
        <div className="st-hero">
          <span className="st-tile-label">Active in the last 5 minutes</span>
          <b className="st-hero-value">{live.last5.toLocaleString("en")}</b>
          <span className="small muted">
            {live.last30.toLocaleString("en")} in the last 30 minutes · {live.last60.toLocaleString("en")} in the last hour · updated {at.toLocaleTimeString("en-GB")}
            {failed && " · the last refresh failed"}
          </span>
        </div>
      </div>
      <div className="st-card">
        <h3 className="st-h3">People active per minute, last 30 minutes</h3>
        <Columns
          columns={live.minutes.map((m) => {
            const t = new Date(m.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            return { key: String(m.t), label: t, title: t, value: m.people };
          })}
          unit="people"
          label="People active per minute, last 30 minutes"
          labelEvery={5}
        />
      </div>
      <p className="small muted">This hour and the last (UTC hours {String(new Date(live.at - 3_600_000).getUTCHours()).padStart(2, "0")}:00 to now):</p>
      <div className="st-grid-3">
        <div className="st-card">
          <h3 className="st-h3">Pages viewed</h3>
          {list(ranked(pages, 8), pageName)}
        </div>
        <div className="st-card">
          <h3 className="st-h3">Countries (visits)</h3>
          {list(ranked(b.countries, 8), (c) => (c === "Other" ? c : `${flag(c)} ${countryName(c)}`))}
        </div>
        <div className="st-card">
          <h3 className="st-h3">What they did</h3>
          {list(ranked(uses, 8), (e) => EVENT_NAMES[e] ?? e)}
        </div>
        <div className="st-card">
          <h3 className="st-h3">Devices (visits)</h3>
          {list(ranked(b.tech.device, 4), (d) => techValue("device", d))}
        </div>
      </div>
    </div>
  );
}
