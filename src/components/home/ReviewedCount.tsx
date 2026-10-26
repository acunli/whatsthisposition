"use client";

import { useEffect, useState } from "react";

/**
 * How many games have been reviewed on the site so far, by everyone (GET /api/reviewed). The line
 * keeps its height while the number loads, so nothing moves when it arrives; without a number
 * (no database, an error) it stays empty.
 */
export function ReviewedCount() {
  const [games, setGames] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/reviewed")
      .then((r) => r.json())
      .then(
        (d: { games?: unknown }) => alive && typeof d.games === "number" && d.games > 0 && setGames(d.games),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <p className={games === null ? "hero-count" : "hero-count hero-count-on"}>
      {games !== null && (
        <>
          <b className="hero-count-n">{games.toLocaleString("en")}</b> {games === 1 ? "game" : "games"} reviewed
        </>
      )}
    </p>
  );
}
