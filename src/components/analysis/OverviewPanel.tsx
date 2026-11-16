"use client";

import type { Color } from "@/lib/chess/types";
import type { Commentary, Point, PositionType } from "@/lib/commentary";
import type { Marks } from "@/lib/facts/types";
import { sideName } from "./bits";

/** Something on the panel that can be shown on the board: hovered, or tapped to keep it there. */
export interface Shown {
  id: string;
  marks: Marks;
  /** What the board's caption says while it is shown. */
  kind: string;
  text: string;
  tone: "opportunity" | "danger" | "info" | "idea";
}

interface Props {
  commentary: Commentary;
  turn: Color;
  /** The engine has finished, so the verdict and the engine's notes are in. */
  settled: boolean;
  pinned: string | null;
  onHover: (s: Shown | null) => void;
  onPin: (s: Shown | null) => void;
  offRoot: boolean;
  onBackToRoot: () => void;
}

const drawn = (m: Marks) => m.squares.length + m.arrows.length + (m.bands?.length ?? 0) + (m.icons?.length ?? 0) + (m.links?.length ?? 0) > 0;

/** One remark: a title and why it matters. Hovering shows it on the board; a tap keeps it there. */
function Remark({ item, pinned, onHover, onPin, sign }: { item: Shown & { body: string }; pinned: boolean; onHover: Props["onHover"]; onPin: Props["onPin"]; sign?: string }) {
  const can = drawn(item.marks);
  return (
    <li>
      <button
        type="button"
        className={`read-item t-${item.tone} ${pinned ? "read-item-on" : ""}`}
        aria-pressed={can ? pinned : undefined}
        onMouseEnter={() => can && onHover(item)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => can && onHover(item)}
        onBlur={() => onHover(null)}
        onClick={() => can && onPin(pinned ? null : item)}
      >
        {sign && (
          <span className="read-sign" aria-hidden>
            {sign}
          </span>
        )}
        <span className="read-words">
          <b>{item.text}</b>
          <span>{item.body}</span>
        </span>
      </button>
    </li>
  );
}

const ofType = (t: PositionType): Shown & { body: string } => ({ id: `type-${t.id}`, marks: t.marks, kind: t.side ? `${sideName(t.side)} · the position` : "The position", text: t.name, body: t.meaning, tone: "info" });
const ofPoint = (p: Point): Shown & { body: string } => ({
  id: p.id + (p.good ? "+" : "-"),
  marks: p.marks,
  kind: `${sideName(p.side)} ${p.good ? "likes" : "doesn't like"}`,
  text: p.title,
  body: p.text,
  tone: p.good ? "opportunity" : "danger",
});

/**
 * The position as a commentator would read it: what kind of position it is, and what each
 * side likes and dislikes about it (lib/commentary). The side to move comes first.
 */
export function OverviewPanel({ commentary, turn, settled, pinned, onHover, onPin, offRoot, onBackToRoot }: Props) {
  const order: Color[] = [turn, turn === "w" ? "b" : "w"];
  // "Middlegame" by itself says nothing the headline hasn't; the other phases come with something to know.
  const types = commentary.types.filter((t) => t.id !== "middlegame" || commentary.types.length === 1);
  return (
    <div className="read desk-body">
      {offRoot && (
        <p className="small muted read-note">
          This describes the position the analysis started from.{" "}
          <button className="linkish" onClick={onBackToRoot}>
            Back to it
          </button>
        </p>
      )}
      <section className="read-block" aria-label="The kind of position">
        <h3 className="read-h">The kind of position</h3>
        <ul className="read-list">
          {types.map((t) => {
            const item = ofType(t);
            return <Remark key={item.id} item={item} pinned={pinned === item.id} onHover={onHover} onPin={onPin} />;
          })}
        </ul>
      </section>
      {order.map((c) => {
        const side = commentary.sides[c];
        return (
          <section key={c} className="read-block" aria-label={`${sideName(c)}'s position`}>
            <h3 className="read-h read-side">
              <span className={`side-dot side-${c}`} aria-hidden />
              {sideName(c)}
              {c === turn && <span className="to-move">To move</span>}
            </h3>
            <div className="read-cols">
              <div>
                <h4 className="eyebrow">Likes</h4>
                {side.likes.length ? (
                  <ul className="read-list">
                    {side.likes.map((p) => {
                      const item = ofPoint(p);
                      return <Remark key={item.id} item={item} pinned={pinned === item.id} onHover={onHover} onPin={onPin} sign="+" />;
                    })}
                  </ul>
                ) : (
                  <p className="small muted read-none">Nothing that stands out{settled ? "" : " on the board alone"}.</p>
                )}
              </div>
              <div>
                <h4 className="eyebrow">Doesn&apos;t like</h4>
                {side.dislikes.length ? (
                  <ul className="read-list">
                    {side.dislikes.map((p) => {
                      const item = ofPoint(p);
                      return <Remark key={item.id} item={item} pinned={pinned === item.id} onHover={onHover} onPin={onPin} sign="−" />;
                    })}
                  </ul>
                ) : (
                  <p className="small muted read-none">No real complaints.</p>
                )}
              </div>
            </div>
          </section>
        );
      })}
      <p className="small muted read-foot">Point at a line to see it on the board; tap to keep it there. Each side&apos;s plans are in the Plans tab.</p>
    </div>
  );
}
