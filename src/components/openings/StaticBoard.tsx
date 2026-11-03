/** A board drawn as one SVG on the server, for pages that show a position without the app (the opening pages). */
export function StaticBoard({ fen, label }: { fen: string; label: string }) {
  const rows = fen.split(" ")[0].split("/");
  const squares: { x: number; y: number; piece?: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) squares.push({ x: x++, y });
      } else squares.push({ x: x++, y, piece: `${ch === ch.toUpperCase() ? "w" : "b"}${ch.toUpperCase()}` });
    }
  });
  return (
    <svg className="sboard" viewBox="0 0 8 8" role="img" aria-label={label}>
      {squares.map(({ x, y, piece }) => (
        <g key={`${x}${y}`}>
          <rect x={x} y={y} width={1} height={1} className={(x + y) % 2 ? "sboard-d" : "sboard-l"} />
          {piece && <image href={`/pieces/${piece}.svg`} x={x} y={y} width={1} height={1} />}
        </g>
      ))}
      {"abcdefgh".split("").map((f, x) => (
        <text key={f} x={x + 0.94} y={7.94} className={`sboard-c ${x % 2 ? "sboard-on-l" : "sboard-on-d"}`} textAnchor="end">
          {f}
        </text>
      ))}
      {[8, 7, 6, 5, 4, 3, 2, 1].map((r, y) => (
        <text key={r} x={0.05} y={y + 0.2} className={`sboard-c ${y % 2 ? "sboard-on-d" : "sboard-on-l"}`}>
          {r}
        </text>
      ))}
    </svg>
  );
}
