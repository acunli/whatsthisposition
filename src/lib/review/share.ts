/**
 * A whole game in a link: `…/#review=<PGN, base64url>&as=w|b&depth=18`. It is in the URL's
 * fragment, which browsers never send to a server, so the game stays private. The
 * browser extension uses it to open a game it has just summarised.
 */
import type { Color } from "../chess/types";

const toBase64Url = (text: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** A link to `site` that opens the game's review, seen from `as`, searched to `depth`. */
export function reviewLink(site: string, pgn: string, as?: Color, depth?: number): string {
  return `${site.replace(/\/+$/, "")}/#review=${toBase64Url(pgn)}${as ? `&as=${as}` : ""}${depth ? `&depth=${depth}` : ""}`;
}

/** The game in a `#review=` fragment, or null. */
export function readReviewHash(hash: string): { pgn: string; as?: Color; depth?: number } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const data = q.get("review");
  if (!data) return null;
  try {
    const pgn = fromBase64Url(data);
    const as = q.get("as");
    const depth = Number(q.get("depth"));
    return { pgn, ...(as === "w" || as === "b" ? { as } : {}), ...(depth > 0 ? { depth } : {}) };
  } catch {
    return null;
  }
}
