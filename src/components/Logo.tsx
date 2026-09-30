"use client";

/**
 * The mark: a knight inside a scanning lens. The ring draws itself, the four
 * crosshair ticks snap in, the knight rises, and a scan line sweeps across once:
 * "an X-ray of the position". Knight silhouette from the mpchess set (GPL-3.0+).
 */
const KNIGHT_BASE = "M6.5422 294.1782c1.0776 0 1.1247.8573 1.1247 1.4946H2.0688c0-.649.0465-1.4946 1.1241-1.4946z";
const KNIGHT_HEAD =
  "M6.4242 293.7612H3.3096c.0424-1.2235 1.357-1.8739 1.4169-2.4641.0598-.5903-.208-.7423-.208-.7423s-.1836.7095-.4175.8545c-.234.145-.7784.2813-.7784.2813s-.382.3571-.6072.3323c-.2252-.025-.4179-.5822-.4179-.5822l.7646-1.261.3874-.894.3656-.413.1566-.6066.4401.5334c2.4231 0 2.9485 3.2354 2.0124 4.9617";

export function LogoMark({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <svg className={animate ? "mark mark-anim" : "mark"} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <clipPath id="lens-clip">
          <circle cx="24" cy="24" r="17" />
        </clipPath>
      </defs>
      <circle className="mark-disc" cx="24" cy="24" r="17" />
      <g clipPath="url(#lens-clip)">
        <g className="mark-knight" transform="translate(5.6 4.4) scale(3.7)">
          <g transform="matrix(1.07361 0 0 1 -.233 -286.97)">
            <path d={KNIGHT_BASE} />
            <path d={KNIGHT_HEAD} />
          </g>
          <circle className="mark-eye" cx="5.35" cy="4.05" r="0.34" />
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

export function Logo({ size = 36, animate = true, compact = false }: { size?: number; animate?: boolean; compact?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} animate={animate} />
      {!compact && (
        <span className="logo-word" aria-label="WhatsThisPosition">
          whatsthis<em>position</em>
          <span className="logo-q">?</span>
        </span>
      )}
    </span>
  );
}
