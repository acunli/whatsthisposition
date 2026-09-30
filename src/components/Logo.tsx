"use client";

/**
 * The mark: a question mark built from chessboard squares. The cells light up along
 * the stroke like a piece travelling, then the dot (a red "threat" square) drops in.
 */
const CELLS: [number, number][] = [
  [0, 1],
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 1],
  [4, 2],
  [3, 3],
  [2, 3],
  [2, 4],
];
const DOT: [number, number] = [2, 6];

export function LogoMark({ size = 34, animate = true }: { size?: number; animate?: boolean }) {
  const u = 10;
  return (
    <svg
      className={animate ? "mark mark-anim" : "mark"}
      width={(size * 5) / 7}
      height={size}
      viewBox={`-1 -1 ${5 * u + 2} ${7 * u + 2}`}
      aria-hidden
    >
      {CELLS.map(([x, y], i) => (
        <rect
          key={i}
          x={x * u + 0.5}
          y={y * u + 0.5}
          width={u - 1}
          height={u - 1}
          rx={1.6}
          className={(x + y) % 2 ? "mark-cell mark-dark" : "mark-cell mark-light"}
          style={{ ["--i" as string]: i }}
        />
      ))}
      <rect x={DOT[0] * u + 0.5} y={DOT[1] * u + 0.5} width={u - 1} height={u - 1} rx={1.6} className="mark-dot" />
    </svg>
  );
}

export function Logo({ size = 34, animate = true, compact = false }: { size?: number; animate?: boolean; compact?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} animate={animate} />
      {!compact && (
        <span className="logo-word" aria-label="WhatsThisPosition">
          <span className="logo-a">Whats</span>
          <span className="logo-b">This</span>
          <span className="logo-c">Position</span>
        </span>
      )}
    </span>
  );
}
