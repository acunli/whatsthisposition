"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/** The glide to the new height. */
const MS = 240;
/** How long the height waits for the content to settle, so back-to-back changes become one glide. */
const HOLD_MS = 90;

/**
 * Animates its height when the content inside changes size (a deeper explanation
 * arriving, a longer one replacing a shorter one), so whatever sits below glides once
 * instead of jumping. With reduced motion it simply resizes.
 *
 * `keepHeight`: while true the box may grow but won't shrink. The review sets it while
 * a deeper explanation is on its way: the quick one is often shorter, and shrinking for
 * half a second before growing again reads as the box bouncing.
 */
export function SmoothHeight({ children, className, keepHeight = false }: { children: ReactNode; className?: string; keepHeight?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const keep = useRef(keepHeight);
  const resync = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = i.offsetHeight;
    // The box's height as last laid out: what is on screen when the next change arrives.
    let shown = o.getBoundingClientRect().height;
    let hold: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const boxHeight = () => o.getBoundingClientRect().height;
    const release = () => {
      settle = null;
      o.style.height = "";
      o.style.overflow = "";
      o.style.transition = "";
    };
    const glide = () => {
      hold = null;
      const content = i.offsetHeight;
      const to = keep.current ? Math.max(content, boxHeight()) : content;
      o.style.transition = `height ${MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      o.style.height = `${to}px`;
      // Held taller than its content: stays fixed until keepHeight ends (resync).
      if (to === content) settle = setTimeout(release, MS + 30);
    };
    /** Freeze at `from`, then glide once the content has settled. */
    const change = (from: number) => {
      if (settle) clearTimeout(settle);
      settle = null;
      if (reduced.matches) return release();
      o.style.transition = "none";
      o.style.overflow = "hidden";
      o.style.height = `${from}px`;
      // glide() reads the latest height, so changes during the wait are folded in.
      if (!hold) hold = setTimeout(glide, HOLD_MS);
    };
    // Runs after layout and before paint, so the old height is what gets drawn first.
    // Both boxes are watched: the outer one to know what is on screen, the inner one for changes.
    const ro = new ResizeObserver((entries) => {
      const before = shown;
      shown = boxHeight();
      if (!entries.some((e) => e.target === i)) return;
      const h = i.offsetHeight;
      if (h === last) return;
      last = h;
      // A fixed height (mid-change) is on screen as it is; an automatic one has just
      // grown or shrunk with the content, so what was on screen is its height before.
      change(o.style.height ? boxHeight() : before);
    });
    ro.observe(i);
    ro.observe(o);
    resync.current = () => {
      if (o.style.height && !hold && Math.abs(boxHeight() - i.offsetHeight) > 0.5) change(boxHeight());
    };
    return () => {
      ro.disconnect();
      if (hold) clearTimeout(hold);
      if (settle) clearTimeout(settle);
    };
  }, []);

  useEffect(() => {
    keep.current = keepHeight;
    if (!keepHeight) resync.current();
  }, [keepHeight]);

  return (
    <div ref={outer}>
      <div ref={inner} className={className}>
        {children}
      </div>
    </div>
  );
}
