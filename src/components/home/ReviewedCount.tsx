"use client";

import { useEffect, useRef, useState } from "react";

/** How often the total is asked for while it's on screen. */
const POLL_MS = 5_000;
/** After this long without input the asking rests until the visitor is back, so a tab left open doesn't keep asking. */
const IDLE_MS = 5 * 60_000;
/** How long the number takes to count up: the first time, and to each new total. */
const FIRST_MS = 1_200;
const TICK_MS = 700;

/**
 * "Games Reviewed: 12,345": how many games have been reviewed on the site so far, by everyone,
 * kept live (GET /api/reviewed). It asks again every few seconds while the page is visible, the
 * number is on screen and the visitor is around, and counts up to each new total. The line keeps
 * its height while the number loads, so nothing moves when it arrives; without a number (no
 * database, an error) it stays empty.
 */
export function ReviewedCount() {
  const [games, setGames] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const shownRef = useRef<number | null>(null);
  const box = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let asking = false;
    let inView = true;
    let lastInput = performance.now();
    const active = () => document.visibilityState === "visible" && inView && performance.now() - lastInput < IDLE_MS;
    const tick = async () => {
      timer = null;
      if (!alive || !active()) return void (asking = false);
      asking = true;
      try {
        const d = (await (await fetch("/api/reviewed")).json()) as { games?: unknown };
        // Never backwards (another CDN region may answer from a second earlier).
        if (alive && typeof d.games === "number" && d.games > 0) setGames((g) => Math.max(g ?? 0, d.games as number));
      } catch {
        // Offline for a moment: ask again next time.
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    const resume = () => {
      if (!asking && active()) void tick();
    };
    const onInput = () => {
      lastInput = performance.now();
      resume();
    };
    const seen = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      resume();
    });
    if (box.current) seen.observe(box.current);
    const inputs = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;
    for (const ev of inputs) window.addEventListener(ev, onInput, { passive: true });
    document.addEventListener("visibilitychange", resume);
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      seen.disconnect();
      for (const ev of inputs) window.removeEventListener(ev, onInput);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  // Count up to the latest total.
  useEffect(() => {
    if (games === null) return;
    const from = shownRef.current ?? 0;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = shownRef.current === null ? FIRST_MS : TICK_MS;
    let start = 0;
    let raf = 0;
    const step = (t: number) => {
      start ||= t;
      const k = still ? 1 : Math.min(1, (t - start) / ms);
      const v = Math.round(from + (games - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [games]);

  const text = (n: number) => n.toLocaleString("en");
  return (
    <p ref={box} className={shown === null ? "hero-count" : "hero-count hero-count-on"}>
      {shown !== null && games !== null && (
        <>
          <span className="hero-count-dot" aria-hidden />
          <span className="hero-count-label">Games Reviewed:</span>
          {/* As wide as the total from the start, so the line doesn't shift while it counts. */}
          <b className="hero-count-n" style={{ minWidth: `${text(games).length}ch` }}>
            {text(shown)}
          </b>
        </>
      )}
    </p>
  );
}
