import Link from "next/link";
import { ClassIcon } from "@/components/review/ClassIcon";
import type { Color } from "@/lib/chess/types";
import { longDate, type GameRecord } from "@/lib/content/games";
import { eventLine } from "@/lib/content/text";

/** A reviewed game in a list: players, event, date and both accuracies. */
export function GameLink({ g }: { g: GameRecord }) {
  const s = g.summary;
  const acc = (c: Color) => (s.accuracy[c] != null ? s.accuracy[c]!.toFixed(1) : "–");
  return (
    <li>
      <Link className="games-item" href={`/games/${g.slug}`}>
        <span className="games-players">
          {g.white} vs {g.black}
        </span>
        <span className="small muted">
          {eventLine(g)}
          {g.played && `, ${longDate(g.played)}`}
        </span>
        <span className="games-result small">
          <span className="mono">{s.result}</span>
          <span className="muted">
            Accuracy {acc("w")} and {acc("b")}
          </span>
          {s.moment && (
            <span className="games-moment">
              <ClassIcon cls={s.moment.cls} size={14} />
              {s.moment.name}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
