/**
 * /llms.txt (llmstxt.org): what the site is and its pages, in Markdown, for AI assistants
 * that answer questions like "a free chess game review without a daily limit". Made when the
 * site is built, so the reviewed games it lists are always the latest.
 */
import { EXTENSION_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL, SOURCE_URL } from "@/lib/brand";
import { gameDescription, gameTitle } from "@/lib/content/text";
import { LANDINGS } from "@/lib/landing";
import { allGames } from "@/lib/server/content";

export const dynamic = "force-static";

export function GET() {
  const games = allGames().slice(0, 30);
  const text = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "Free and open source, with no account and no daily limit: Stockfish 19 runs in the visitor's browser, so a review costs nothing to serve. Every move of a Chess.com or Lichess game (by username or link) or of any PGN gets a Chess.com-style label (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder) and an explanation drawn from the engine's lines, with both players' accuracy on Chess.com's scale, an evaluation graph, key moments and opening theory from 1.8 million games between strong players. It also analyses a single position from a FEN, a board set up by hand, or a screenshot read on the device. A Chrome extension reviews a finished Chess.com game on its own page.",
    "",
    "## Tools",
    "",
    `- [Game review](${SITE_URL}/): review any game by Chess.com or Lichess username, game link or PGN.`,
    ...LANDINGS.map((p) => `- [${p.name}](${SITE_URL}${p.path}): ${p.description}`),
    `- [Chrome extension for Chess.com](${EXTENSION_URL}): reviews a finished Chess.com game on the game page, with accuracy and every move labelled.`,
    "",
    "## Reviewed games",
    "",
    `- [Top players' games, reviewed](${SITE_URL}/games): recent games from top over-the-board events and Chess.com's leaderboards, reviewed daily.`,
    ...games.map((g) => `- [${gameTitle(g)}](${SITE_URL}/games/${g.slug}): ${gameDescription(g)}`),
    "",
    "## About",
    "",
    `- [How it works, licences and privacy](${SITE_URL}/credits)`,
    `- [Source code](${SOURCE_URL}) (GPL-3.0)`,
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
