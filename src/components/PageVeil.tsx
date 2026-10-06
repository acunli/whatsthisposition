"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogoMark, Wordmark } from "./Logo";

/**
 * The loading screen: the logo animation on a full-screen veil.
 *
 * - First load: the veil is in the server HTML, so it shows before any script runs.
 *   It lifts once the page has hydrated and the logo has played (BOOT_MS). If scripts
 *   never run, CSS lifts it after a few seconds anyway.
 * - Page changes: `showPageChange(fn)` (the studio's stages) and clicks on internal
 *   links (other routes) bring the veil back with a quicker cut of the animation, run
 *   the change underneath it, and lift it after NAV_MS.
 * - Reduced motion: no veil on page changes; on first load a static logo and a short fade.
 */
const BOOT_MS = 1700;
const NAV_MS = 800;
const IN_MS = 170;
const OUT_MS = 360;
const EVENT = "wtp:page-change";

type Phase = "boot" | "in" | "out" | "hidden";

/** Runs `change` (e.g. switching the studio's stage) under the loading veil. */
export function showPageChange(change: () => void) {
  if (typeof window === "undefined") return change();
  const e = new CustomEvent<() => void>(EVENT, { detail: change, cancelable: true });
  // Nobody listening (or reduced motion): just do it.
  if (window.dispatchEvent(e)) change();
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PageVeil() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [run, setRun] = useState(0);
  const phaseRef = useRef<Phase>("boot");
  const shownAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingRoute = useRef<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const lift = (minMs: number) => {
    later(Math.max(0, minMs - (performance.now() - shownAt.current)), () => {
      set("out");
      later(OUT_MS, () => set("hidden"));
    });
  };

  // First load: lift once hydrated, fonts are in, and the logo has played.
  useEffect(() => {
    const t = timers.current;
    const elapsed = performance.now();
    if (elapsed > 4300) {
      // The CSS fallback has already lifted it.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync with the CSS fallback
      set("hidden");
      return;
    }
    shownAt.current = 0;
    const min = reducedMotion() ? 250 : BOOT_MS;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void fonts.then(() => lift(min));
    return () => t.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
  }, []);

  // Page changes inside the studio.
  useEffect(() => {
    const onChange = (e: Event) => {
      const change = (e as CustomEvent<() => void>).detail;
      if (reducedMotion()) return; // not cancelled: showPageChange runs it directly
      e.preventDefault();
      if (phaseRef.current !== "hidden") {
        // Already covering the page: change underneath.
        change();
        return;
      }
      timers.current.forEach(clearTimeout);
      timers.current = [];
      shownAt.current = performance.now();
      setRun((r) => r + 1);
      set("in");
      later(IN_MS, () => {
        change();
        // Two frames: the new page has rendered under the veil.
        requestAnimationFrame(() => requestAnimationFrame(() => lift(NAV_MS)));
      });
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers only use refs and setters
  }, []);

  // Internal links to another route (e.g. /credits).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reducedMotion()) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      timers.current.forEach(clearTimeout);
      timers.current = [];
      shownAt.current = performance.now();
      pendingRoute.current = url.pathname;
      setRun((r) => r + 1);
      set("in");
      later(IN_MS, () => router.push(url.pathname + url.search + url.hash));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  // The route has changed: lift the veil.
  useEffect(() => {
    if (pendingRoute.current && pendingRoute.current === pathname) {
      pendingRoute.current = null;
      requestAnimationFrame(() => lift(NAV_MS));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the route only
  }, [pathname]);

  return (
    <div className={`veil veil-${phase}`} aria-hidden="true">
      {phase !== "hidden" && (
        <div key={run} className={run ? "veil-inner veil-fast" : "veil-inner"}>
          <LogoMark size={92} />
          <Wordmark className="veil-word" />
        </div>
      )}
    </div>
  );
}
