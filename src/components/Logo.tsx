"use client";

import { useId } from "react";
import { WORDMARK } from "@/lib/brand";
import { KNIGHT_BASE, KNIGHT_HEAD } from "@/lib/logoPaths";

/**
 * The mark: a knight inside a scanning lens. The ring draws itself, the four
 * crosshair ticks snap in, the knight rises, and a scan line sweeps across once:
 * "an X-ray of the position". Knight silhouette from the mpchess set (GPL-3.0+).
 * The same animation is the loading screen (PageVeil).
 */
export function LogoMark({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  const clip = `lens-${useId().replace(/:/g, "")}`;
  return (
    <svg className={animate ? "mark mark-anim" : "mark"} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="17" />
        </clipPath>
      </defs>
      <circle className="mark-disc" cx="24" cy="24" r="17" />
      <g clipPath={`url(#${clip})`}>
        {/* The animated group has no transform attribute: Safari lets a CSS animation
            replace that attribute outright, which shrank the knight out of the lens. */}
        <g className="mark-knight">
          <g transform="translate(5.6 4.4) scale(3.7)">
            <g transform="matrix(1.07361 0 0 1 -.233 -286.97)">
              <path d={KNIGHT_BASE} />
              <path d={KNIGHT_HEAD} />
            </g>
            <circle className="mark-eye" cx="5.35" cy="4.05" r="0.34" />
          </g>
        </g>
        <rect className="mark-scan" x="4" y="0" width="40" height="3" />
      </g>
      <circle className="mark-ring" cx="24" cy="24" r="20" pathLength={1} />
      <g className="mark-ticks">
        <path d="M24 1.5v5M24 41.5v5M1.5 24h5M41.5 24h5" />
      </g>
      <circle className="mark-dot" cx="38.2" cy="9.8" r="3.2" />
    </svg>
  );
}

/** The wordmark on its own: "what’sthis" in bone, "position" in orange, one weight. */
export function Wordmark({ className = "logo-word" }: { className?: string }) {
  return (
    <span className={className}>
      {WORDMARK[0]}
      <span className="logo-pos">{WORDMARK[1]}</span>
    </span>
  );
}

export function Logo({ size = 36, animate = true, compact = false }: { size?: number; animate?: boolean; compact?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} animate={animate} />
      {!compact && <Wordmark />}
    </span>
  );
}
