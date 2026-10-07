"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogoMark, Wordmark } from "./Logo";

/**
 * The loading screen: the logo animation on a full-screen veil. It stays up until the
 * page underneath is ready to run smoothly, so the first thing you see doesn't stutter.
 *
 * - First load: the veil is in the server HTML, so it shows before any script runs.
 *   The logo waits on its first frame until the page has hydrated: a phone can spend
 *   seconds running scripts before it paints, and an animation started earlier would
 *   play unseen and appear already finished. Then it plays in one piece, and the veil
 *   lifts when all of these hold: the logo has played to the end, fonts are in,
 *   every component holding the veil
 *   (`holdPageVeil`, e.g. the 3D hero until its first frames are drawn) has let go,
 *   and the browser is drawing frames smoothly again. Heavy work waits for the logo
 *   (`useBootLogoPlayed`), so the animation itself doesn't stutter.
 *   Caps keep it from ever waiting too long; if scripts never run, CSS lifts it.
 * - Page changes: `showPageChange(fn)` (the studio's stages) and clicks on internal
 *   links (other routes) bring the veil back with a quicker cut of the animation, run
 *   the change underneath it, and lift it the same way (once that cut has played).
 * - When it lifts it fires "wtp:revealed", so intro animations start in view.
 * - Reduced motion: no veil on page changes; on first load a static logo and a short fade.
 */
/** How long the logo takes, for browsers that can't report their animations. */
const BOOT_MS = 2100;
/** The longest the first-load veil stays up once the logo starts playing. */
const BOOT_CAP_MS = 5500;
const NAV_MS = 1000;
const NAV_CAP_MS = 3000;
/** A beat on the finished logo before the veil lifts. */
const BEAT_MS = 220;
const IN_MS = 170;
const OUT_MS = 360;
const EVENT = "wtp:page-change";
export const REVEALED_EVENT = "wtp:revealed";
const LOGO_EVENT = "wtp:logo-played";

// Whether the first-load logo animation has finished.
let bootLogoPlayed = false;
const subscribeLogo = (cb: () => void) => {
  window.addEventListener(LOGO_EVENT, cb);
  return () => window.removeEventListener(LOGO_EVENT, cb);
};

/**
 * True once the first-load logo animation has played to the end. Heavy first renders
 * (the 3D hero compiling its shaders) wait for it, so the animation runs smoothly.
 */
export function useBootLogoPlayed(): boolean {
  return useSyncExternalStore(
    subscribeLogo,
    () => bootLogoPlayed,
    () => false,
  );
}

function markBootLogoPlayed() {
  if (bootLogoPlayed) return;
  bootLogoPlayed = true;
  window.dispatchEvent(new Event(LOGO_EVENT));
}

// Components that need the veil to stay up a little longer (heavy first render).
const holds = new Set<symbol>();
const holdWaiters = new Set<() => void>();

/**
 * Keeps the loading veil up until the returned function is called (or `maxMs` passes):
 * for work that would make the first seconds stutter, like compiling 3D shaders.
 */
export function holdPageVeil(maxMs = 5000): () => void {
  const id = Symbol("veil-hold");
  holds.add(id);
  const release = () => {
    if (!holds.delete(id)) return;
    if (!holds.size) holdWaiters.forEach((f) => f());
  };
  setTimeout(release, maxMs);
  return release;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const released = () =>
  holds.size
    ? new Promise<void>((r) => {
        const f = () => {
          holdWaiters.delete(f);
          r();
        };
        holdWaiters.add(f);
      })
    : Promise.resolve();

/** Resolves when the browser draws `frames` frames in a row within `budget` ms each (or after `maxMs`). */
function smooth(frames = 8, budget = 34, maxMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    let calm = 0;
    const tick = (now: number) => {
      calm = now - last < budget ? calm + 1 : 0;
      last = now;
      if (calm >= frames || now - t0 > maxMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Resolves when every animation in the logo has finished, wherever it started, or
 * after `capMs`. Without the Web Animations API (or with reduced motion, where there
 * are no animations) it waits `fallbackMs` from `since` instead.
 */
function logoPlayed(el: Element | null, since: number, fallbackMs: number, capMs: number): Promise<void> {
  const anims = el && typeof el.getAnimations === "function" ? el.getAnimations({ subtree: true }) : [];
  const elapsed = performance.now() - since;
  if (!anims.length) return sleep(fallbackMs - elapsed);
  const done = Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => sleep(BEAT_MS));
  return Promise.race([done, sleep(capMs - elapsed)]);
}

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
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const phaseRef = useRef<Phase>("boot");
  const shownAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingRoute = useRef<string | null>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const generation = useRef(0);
  /**
   * Lift once the logo has played (`played`), holds are released (up to `capMs`), and
   * frames are smooth.
   */
  const lift = (played: Promise<void>, capMs: number) => {
    const gen = ++generation.current;
    const since = shownAt.current;
    const left = () => capMs - (performance.now() - since);
    // Holds are counted once the logo has played: by then everything that needs one has asked.
    void played
      .then(() => Promise.race([released(), sleep(left())]))
      .then(() => smooth(8, 34, Math.max(300, left())))
      .then(() => {
        if (gen !== generation.current) return; // a newer page change took over
        set("out");
        window.dispatchEvent(new Event(REVEALED_EVENT));
        later(OUT_MS, () => set("hidden"));
      });
  };
  const liftAfterLogo = (fallbackMs: number, capMs: number) => lift(logoPlayed(inner.current, shownAt.current, fallbackMs, capMs), capMs);

  // First load: lift once hydrated, fonts are in, and the logo has played.
  useEffect(() => {
    const t = timers.current;
    const elapsed = performance.now();
    if (elapsed > 7800) {
      // The CSS fallback has already lifted it.
      markBootLogoPlayed();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync with the CSS fallback
      set("hidden");
      return;
    }
    const fonts = document.fonts?.ready ?? Promise.resolve();
    let raf = 0;
    // Start once frames are flowing smoothly: right after hydration a phone can still
    // stall (more scripts, the GPU starting up), and the logo would jump ahead unseen.
    void fonts
      .then(() => smooth(6, 34, 2000))
      .then(() => {
        shownAt.current = performance.now();
        setPlaying(true);
        // The animations run from the next style update; read them after it.
        raf = requestAnimationFrame(() => {
          const played = logoPlayed(inner.current, shownAt.current, reducedMotion() ? 250 : BOOT_MS, BOOT_CAP_MS);
          void played.then(markBootLogoPlayed);
          lift(played, BOOT_CAP_MS);
        });
      });
    return () => {
      cancelAnimationFrame(raf);
      t.forEach(clearTimeout);
    };
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
        requestAnimationFrame(() => requestAnimationFrame(() => liftAfterLogo(NAV_MS, NAV_CAP_MS)));
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
      requestAnimationFrame(() => liftAfterLogo(NAV_MS, NAV_CAP_MS));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the route only
  }, [pathname]);

  return (
    <div className={`veil veil-${phase}${playing ? " veil-play" : ""}`} aria-hidden="true">
      {phase !== "hidden" && (
        <div key={run} ref={inner} className={run ? "veil-inner veil-fast" : "veil-inner"}>
          <LogoMark size={92} />
          <Wordmark className="veil-word" />
        </div>
      )}
    </div>
  );
}
