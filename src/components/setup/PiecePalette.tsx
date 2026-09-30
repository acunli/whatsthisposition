"use client";

export type Tool = "move" | "erase" | `${"w" | "b"}${"K" | "Q" | "R" | "B" | "N" | "P"}`;

const PIECES = ["K", "Q", "R", "B", "N", "P"] as const;

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  onClear: () => void;
  onStart: () => void;
  onFlip: () => void;
}

export function PiecePalette({ tool, onTool, onClear, onStart, onFlip }: Props) {
  return (
    <div className="palette" role="toolbar" aria-label="Board editing tools">
      <div className="palette-row">
        <button className={tool === "move" ? "tool tool-on" : "tool"} onClick={() => onTool("move")} aria-pressed={tool === "move"} title="Move pieces">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
          </svg>
          <span className="sr-only">Move</span>
        </button>
        {(["w", "b"] as const).map((c) => (
          <div key={c} className="palette-group">
            {PIECES.map((p) => {
              const t = `${c}${p}` as Tool;
              return (
                <button key={t} className={tool === t ? "tool tool-on" : "tool"} onClick={() => onTool(t)} aria-pressed={tool === t} title={`Place ${c === "w" ? "White" : "Black"} ${p}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/pieces/${t}.svg`} alt={`${c === "w" ? "White" : "Black"} ${p}`} />
                </button>
              );
            })}
          </div>
        ))}
        <button className={tool === "erase" ? "tool tool-on" : "tool"} onClick={() => onTool("erase")} aria-pressed={tool === "erase"} title="Erase">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
          <span className="sr-only">Erase</span>
        </button>
      </div>
      <div className="palette-actions">
        <button className="btn btn-ghost btn-sm" onClick={onStart}>
          Start position
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear board
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onFlip}>
          Flip board ⇅
        </button>
      </div>
    </div>
  );
}
