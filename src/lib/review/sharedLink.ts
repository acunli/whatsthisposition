/**
 * Games handed to the site from outside it, as an address:
 * - a Chess.com or Lichess address typed after the site's own (whatsthisposition.com/chess.com/game/live/1…,
 *   or the whole link pasted after it: whatsthisposition.com/https://lichess.org/abcd1234);
 * - what a phone's share sheet sends the installed app (/share): a text or link that has a game
 *   link in it, or a PGN.
 */

/** Chess.com and Lichess hosts, with or without www. or m. */
const HOST = /^(?:www\.|m\.)?(chess\.com|lichess\.org)(?=\/|$)/i;

/**
 * The Chess.com or Lichess address in a path of this site (with its query, if any), as a full link,
 * or null. The scheme is optional and its slashes may have been merged ("https:/chess.com/…").
 */
export function linkInPath(pathAndQuery: string): string | null {
  let rest = pathAndQuery.replace(/^\/+/, "");
  try {
    rest = decodeURI(rest);
  } catch {
    // Not percent-encoded properly: read it as it is.
  }
  rest = rest.replace(/^https?:\/*/i, "");
  const m = rest.match(HOST);
  if (!m) return null;
  return `https://${m[0].toLowerCase().startsWith("m.") ? rest.slice(2) : rest}`;
}

/** The first Chess.com or Lichess link in a text, or null. */
export function linkInText(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:chess\.com|lichess\.org)\/[^\s"'<>]+/i);
  return m ? linkInPath(m[0].replace(/[).,;!?]+$/, "")) : null;
}

/** Whether a text looks like a game's moves (a PGN or a move list) rather than a message. */
export function looksLikeGame(text: string): boolean {
  return /\[\s*(?:Event|White|Black|FEN)\s+"/.test(text) || /(?:^|\s)1\.\s*(?:[a-h][1-8]|[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|O-O)/.test(text);
}
