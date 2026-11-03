"use client";

import Link from "next/link";
import { useEffect } from "react";
import { errorWhere } from "@/lib/stats/fields";
import { countUse } from "@/lib/usage";

/** A script of the deployment the page was loaded from is gone (the site was updated since). */
const STALE = /ChunkLoadError|Loading (CSS )?chunk|Failed to load chunk|dynamically imported module|Importing a module script failed/i;
/** When the page last reloaded itself, so a script that stays missing doesn't reload it in a loop. */
const RELOADED = "wtp-reloaded";

/**
 * Shown when a page throws: say what happened and offer a way back. A page left open while the
 * site was updated can't load the scripts it still asks for: it reloads itself once instead (the
 * review page keeps its game for the tab, so nothing is lost).
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    countUse("error", "page", { x: errorWhere(error, window.location.origin) });
    if (!STALE.test(`${error.name} ${error.message}`)) return;
    try {
      if (Date.now() - Number(sessionStorage.getItem(RELOADED) ?? 0) < 60_000) return;
      sessionStorage.setItem(RELOADED, String(Date.now()));
    } catch {
      return;
    }
    // A moment for the count to leave.
    const t = setTimeout(() => window.location.reload(), 300);
    return () => clearTimeout(t);
  }, [error]);
  return (
    <main className="prose status-page">
      <h1>Something broke.</h1>
      <p>This page hit an unexpected error. Your games and positions aren&apos;t stored anywhere, so reloading is safe.</p>
      <p className="status-actions">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/">
          Go to the home page
        </Link>
      </p>
      {error.digest && <p className="small muted">Error reference: {error.digest}</p>}
    </main>
  );
}
