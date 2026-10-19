/**
 * The words of a reviewed game's page (/games/[slug]), all made from its record: the title,
 * the description, the event line and the lede. Shared by the page, its metadata and the
 * index, so they always say the same thing.
 */
import { CARD_CLASSES, countWords } from "../review/shareCard";
import { longDate, resultWords, type GameRecord } from "./games";

/** "European Chess Club Cup 2026, Open, round 2" or "Chess.com blitz". */
export function eventLine(g: GameRecord): string {
  const event = g.source.event.replace(/\s*\|\s*/g, ", ");
  const round = g.source.round && /^round\s+\d+$/i.test(g.source.round) ? g.source.round.toLowerCase() : g.source.round;
  return round ? `${event}, ${round}` : event;
}

/** The page title: "Anish Giri vs Sergei Movsesian: game review". */
export const gameTitle = (g: GameRecord) => `${g.white} vs ${g.black}: game review`;

const acc = (n: number | null) => (n != null ? n.toFixed(1) : "–");

/** The search snippet: event, result, accuracies and what stood out. */
export function gameDescription(g: GameRecord): string {
  const s = g.summary;
  const notable = CARD_CLASSES.filter((c) => c !== "best")
    .map((c) => [c, (s.counts.w[c] ?? 0) + (s.counts.b[c] ?? 0)] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => countWords(c, n));
  const when = g.played ? ` (${longDate(g.played)})` : "";
  return `${eventLine(g)}${when}. ${resultWords(s.result, g.white, g.black)}. Accuracy ${g.white} ${acc(s.accuracy.w)}, ${g.black} ${acc(s.accuracy.b)}${notable.length ? `; ${notable.join(", ")}` : ""}. Every move labelled and explained.`;
}

/** The opening paragraph. */
export function gameLede(g: GameRecord): string {
  const s = g.summary;
  const parts = [`${resultWords(s.result, g.white, g.black)}${g.played ? ` on ${longDate(g.played)}` : ""}${s.opening ? `, in the ${s.opening}` : ""}.`];
  parts.push(`Stockfish 19 reviewed every move of both players at depth ${g.depth}, double-checked the sharp moments deeper, and labelled each one from Brilliant to Blunder.`);
  return parts.join(" ");
}
