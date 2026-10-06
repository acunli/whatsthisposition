import { CLASS_INFO, CLASS_ORDER, type MoveClass } from "@/lib/review/classify";
import { ClassIcon } from "../review/ClassIcon";

/** The rule behind every label, exactly as src/lib/review/classify.ts applies it. */
const RULES: Record<MoveClass, string> = {
  brilliant: "A best or near-best move that really gives material away. The sacrifice is checked with exchange maths on the board, not guessed from the score.",
  great: "The only good move: every alternative throws away at least 10% of your winning chances.",
  best: "The engine's top choice in the position.",
  excellent: "Not the top move, but it costs under 2% of your winning chances.",
  good: "Costs between 2% and 5% of your winning chances.",
  book: "Opening theory: a move strong players really choose here, from 1.8 million of their games.",
  inaccuracy: "Gives away 5–10% of your winning chances.",
  mistake: "Gives away 10–20% of your winning chances.",
  miss: "Your opponent just made a mistake and you let it go unpunished.",
  blunder: "Gives away 20% or more, or walks into a forced mate.",
  forced: "The only legal move.",
};

export function Labels() {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="h-section">Every move gets a label</h2>
        <p className="section-lede">
          Each move is compared with Stockfish&apos;s best in winning chances, on Lichess&apos;s win-probability curve. The same rules apply to every game, from your blitz games to
          world championships.
        </p>
      </div>
      <ul className="legend">
        {CLASS_ORDER.map((c) => (
          <li key={c} style={{ ["--cls" as string]: CLASS_INFO[c].color }}>
            <ClassIcon cls={c} size={28} />
            <b>{CLASS_INFO[c].label}</b>
            <span>{RULES[c]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
