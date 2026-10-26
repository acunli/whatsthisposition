"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useRef } from "react";
import { channelOf } from "@/lib/channel";
import { MAX_SECONDS, VITALS, errorWhere, pagePath, type VitalName } from "@/lib/stats/fields";
import { countUse, deviceClasses, rememberChannel, sendUse } from "@/lib/usage";

/**
 * Counts, anonymously, on every page but /stats: one visit per page load (where it started: the
 * extension's link, a shared review's #review link or /r/ page, or anything else; the channel it
 * came from; the device's coarse classes), each further page opened within the site, how long
 * each page stayed visible, how fast the page loaded (Web Vitals), and whether a script broke.
 * The address is read when this module loads, before any page code runs: the app clears a
 * #review link from the address bar as soon as it opens it.
 */
const first = typeof window === "undefined" ? null : { hash: window.location.hash, search: window.location.search, path: window.location.pathname, referrer: document.referrer };
const counted = (path: string) => !path.startsWith("/stats");
/** "ResizeObserver loop completed with undelivered notifications." (and Chrome's older "…limit exceeded"). */
const BENIGN_ERROR = /^ResizeObserver loop/;

/** Page-speed measurements waiting to be sent with the next report, each sent once per page load. */
const vitals: Partial<Record<VitalName, number>> = {};
const vitalsSent = new Set<string>();
const keepVital = (m: { name: string; value: number }) => {
  if (Object.hasOwn(VITALS, m.name) && !vitalsSent.has(m.name)) vitals[m.name as VitalName] = m.value;
};

export function UsageTracker() {
  const path = usePathname();
  useReportWebVitals(keepVital);
  // Visible seconds per page since the last report, and the page being timed now.
  const time = useRef<{ page: string; since: number | null; pending: Record<string, number> }>({ page: "", since: null, pending: {} });

  useEffect(() => {
    if (!first || !counted(first.path)) return;
    const handed = /^#(.*&)?review=/.test(first.hash);
    const from = channelOf(first.referrer, first.search, window.location.hostname);
    rememberChannel(from);
    countUse("visit", first.path.startsWith("/r/") ? "link" : handed ? (/[#&]data=/.test(first.hash) ? "extension" : "link") : "direct", { p: pagePath(first.path), d: deviceClasses() });

    const clock = time.current;
    const stop = () => {
      if (clock.since === null) return;
      const secs = Math.min(MAX_SECONDS, (performance.now() - clock.since) / 1000);
      clock.pending[clock.page] = (clock.pending[clock.page] ?? 0) + secs;
      clock.since = null;
    };
    const report = () => {
      stop();
      const t: Record<string, number> = {};
      for (const [page, secs] of Object.entries(clock.pending)) if (Math.round(secs) > 0) t[page] = Math.round(secs);
      clock.pending = {};
      const v = { ...vitals };
      for (const k of Object.keys(v)) {
        vitalsSent.add(k);
        delete vitals[k as VitalName];
      }
      if (Object.keys(t).length || Object.keys(v).length) sendUse({ e: "leave", ...(Object.keys(t).length ? { t } : {}), ...(Object.keys(v).length ? { v } : {}) });
    };
    // Registered after Web Vitals' own listeners (they capture), so the final layout-shift and
    // responsiveness numbers are in by the time this reports.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report();
      else if (clock.since === null && clock.page) clock.since = performance.now();
    };
    let broke = false;
    const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
      if (broke || ("filename" in e && e.filename && !e.filename.startsWith(window.location.origin))) return;
      // The browser's note that some size changes were passed on a frame later: nothing broke.
      if ("message" in e && BENIGN_ERROR.test(e.message)) return;
      broke = true;
      countUse("error", "script", { x: errorWhere("reason" in e ? e.reason : e.error, window.location.origin) });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", report);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", report);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
  }, []);

  // Each page shown: timed while visible, and counted when it's opened within the site.
  useEffect(() => {
    if (!first || !counted(first.path)) return;
    const clock = time.current;
    const page = counted(path) ? pagePath(path) : "";
    if (clock.since !== null && clock.page) clock.pending[clock.page] = (clock.pending[clock.page] ?? 0) + Math.min(MAX_SECONDS, (performance.now() - clock.since) / 1000);
    const opened = clock.page !== "" || clock.since !== null;
    clock.page = page;
    clock.since = page && document.visibilityState === "visible" ? performance.now() : null;
    if (opened && page) countUse("page");
  }, [path]);

  return null;
}
