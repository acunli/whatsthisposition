"use client";

import Link from "next/link";
import { useEffect } from "react";
import { errorWhere } from "@/lib/stats/fields";
import { countUse } from "@/lib/usage";

/** Shown when a page throws: say what happened and offer a way back. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    countUse("error", "page", { x: errorWhere(error, window.location.origin) });
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
