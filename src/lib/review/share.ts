/**
 * A whole game in a link: `…/#review=<PGN, base64url>&as=w|b&depth=18&data=<review>`. It is in the URL's
 * fragment, which browsers never send to a server, so the game stays private. The
 * browser extension uses it to open a game it has just summarised.
 */
import type { Color } from "../chess/types";
import type { EngineLine } from "../engine/client";
import type { Evaluation } from "../engine/score";
import type { PositionAnalysis } from "./classify";

const toBase64Url = (text: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** A link to `site` that opens the game's review, seen from `as`, searched to `depth`; `data` is a finished review (`packReview`). */
export function reviewLink(site: string, pgn: string, as?: Color, depth?: number, data?: string): string {
  return `${site.replace(/\/+$/, "")}/#review=${toBase64Url(pgn)}${as ? `&as=${as}` : ""}${depth ? `&depth=${depth}` : ""}${data ? `&data=${data}` : ""}`;
}

/** The game in a `#review=` fragment, or null. */
export function readReviewHash(hash: string): { pgn: string; as?: Color; depth?: number; data?: string } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const data = q.get("review");
  if (!data) return null;
  try {
    const pgn = fromBase64Url(data);
    const as = q.get("as");
    const depth = Number(q.get("depth"));
    const packed = q.get("data");
    return { pgn, ...(as === "w" || as === "b" ? { as } : {}), ...(depth > 0 ? { depth } : {}), ...(packed ? { data: packed } : {}) };
  } catch {
    return null;
  }
}

/**
 * A finished review travels with the game (`&data=…`), so the site can show it without
 * running Stockfish again: per position the depth, the evaluation and the engine lines
 * (plus the best quiet move, where a sacrifice needed one), packed small (evals as
 * centipawns or "M3w", moves as one UCI string) and gzipped.
 */
type PackedEval = number | string;
type PackedLine = [ev: PackedEval, pv: string, multipv: number, depth: number];
type PackedPosition = [depth: number, ev: PackedEval, lines: PackedLine[], quiet?: PackedLine] | null;
interface PackedReview {
  v: 1;
  depth: number;
  p: PackedPosition[];
}

const packEval = (e: Evaluation): PackedEval => (e.kind === "cp" ? Math.round(e.cp) : `M${e.moves}${e.winner}`);
const unpackEval = (x: PackedEval): Evaluation | null => {
  if (typeof x === "number" && Number.isFinite(x)) return { kind: "cp", cp: x };
  const m = typeof x === "string" ? /^M(-?\d{1,3})([wb])$/.exec(x) : null;
  return m ? { kind: "mate", moves: Number(m[1]), winner: m[2] as Color } : null;
};
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const base64UrlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function packReview(positions: (PositionAnalysis | null)[], depth: number): Promise<string> {
  const packed: PackedReview = {
    v: 1,
    depth,
    p: positions.map((pa): PackedPosition => {
      if (!pa) return null;
      const line = (l: EngineLine): PackedLine => [packEval(l.eval), l.pv.join(" "), l.multipv, l.depth];
      return pa.quiet ? [pa.depth, packEval(pa.eval), pa.lines.map(line), line(pa.quiet)] : [pa.depth, packEval(pa.eval), pa.lines.map(line)];
    }),
  };
  return bytesToBase64Url(await gzip(JSON.stringify(packed)));
}

/** The review packed by `packReview`, checked field by field, or null. */
export async function unpackReview(data: string): Promise<{ depth: number; positions: (PositionAnalysis | null)[] } | null> {
  try {
    const raw = JSON.parse(await gunzip(base64UrlToBytes(data))) as PackedReview;
    if (raw?.v !== 1 || !Array.isArray(raw.p) || raw.p.length > 2000 || typeof raw.depth !== "number") return null;
    const line = ([lev, pv, multipv, d]: PackedLine): EngineLine => {
      const le = unpackEval(lev);
      const moves = typeof pv === "string" && pv ? pv.split(" ") : [];
      if (!le || !moves.every((m) => UCI.test(m)) || typeof multipv !== "number" || typeof d !== "number") throw new Error("bad line");
      return { multipv, depth: d, eval: le, pv: moves };
    };
    const positions = raw.p.map((x): PositionAnalysis | null => {
      if (x === null) return null;
      const [depth, ev, lines, quiet] = x;
      const e = unpackEval(ev);
      if (typeof depth !== "number" || !e || !Array.isArray(lines) || (quiet !== undefined && !Array.isArray(quiet))) throw new Error("bad position");
      return { depth, eval: e, lines: lines.map(line), ...(quiet ? { quiet: line(quiet) } : {}) };
    });
    return { depth: raw.depth, positions };
  } catch {
    return null;
  }
}
