/**
 * The master opening book: what strong players actually played, position by position.
 * Built by scripts/build-book.mjs from Lichess broadcasts (over-the-board games, CC BY-SA
 * 4.0) and the Lichess Elite Database (online games, 2500+ vs 2300+, from the CC0 Lichess
 * database). Positions are keyed like the named book (placement + side to move), so
 * transpositions are recognised.
 */
import { Chess } from "chess.js";
import { hash53 } from "./positionKey";

export interface MasterMove {
  uci: string;
  /** Games in which it was played here. */
  count: number;
  /** Results after it, in percent. */
  white: number;
  draw: number;
  black: number;
}

export interface MasterEntry {
  /** Games that reached the position. */
  total: number;
  /** Most played first. */
  moves: MasterMove[];
}

export interface MastersBook {
  games: number;
  minElo: number;
  maxPly: number;
  positions: number;
  get(fen: string): MasterEntry | null;
}

const FILES = "abcdefgh";
const PROMO = ["", "n", "b", "r", "q"];
const sqName = (i: number) => `${FILES[i & 7]}${(i >> 3) + 1}`;
const uciOf = (code: number) => `${sqName(code >> 9)}${sqName((code >> 3) & 63)}${PROMO[code & 7] ?? ""}`;

/** Parses the "WTPB" v2 file written by scripts/build-book.mjs. */
export function parseMasters(buf: ArrayBuffer): MastersBook {
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== "WTPB" || v.getUint8(4) !== 2) throw new Error("Not a master book (v2) file.");
  const maxPly = v.getUint8(5);
  const minElo = v.getUint16(6, true);
  const games = v.getUint32(8, true);
  const n = v.getUint32(12, true);
  // 48-bit keys fit a Float64Array exactly and sort like the file.
  const keys = new Float64Array(n);
  const offsets = new Uint32Array(n);
  let o = 16;
  for (let i = 0; i < n; i++) {
    keys[i] = v.getUint32(o, true) + v.getUint16(o + 4, true) * 4294967296;
    offsets[i] = o;
    o += 11 + v.getUint8(o + 10) * 7;
  }
  const at = (i: number): MasterEntry => {
    const p = offsets[i];
    const total = v.getUint32(p + 6, true);
    const k = v.getUint8(p + 10);
    const moves: MasterMove[] = [];
    for (let j = 0; j < k; j++) {
      const q = p + 11 + j * 7;
      const count = v.getUint16(q + 2, true) + v.getUint8(q + 4) * 65536;
      const white = v.getUint8(q + 5);
      const draw = v.getUint8(q + 6);
      moves.push({ uci: uciOf(v.getUint16(q, true)), count, white, draw, black: Math.max(0, 100 - white - draw) });
    }
    return { total, moves };
  };
  return {
    games,
    minElo,
    maxPly,
    positions: n,
    get(fen) {
      const k = hash53(fen.split(" ").slice(0, 2).join(" "));
      const key = (k % 4294967296) + (Math.floor(k / 4294967296) & 0xffff) * 4294967296;
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] < key) lo = mid + 1;
        else if (keys[mid] > key) hi = mid - 1;
        else return at(mid);
      }
      return null;
    },
  };
}

/**
 * A move counts as master theory when it is a real choice among strong players here:
 * at least 0.5% of the games, or 25 games and 0.1%. One-off moves don't make it theory.
 * scripts/build-book.mjs uses the same rule (plus a 3-game floor) to decide what to keep.
 */
export function isTheory(entry: MasterEntry | null, uci: string): MasterMove | null {
  const m = entry?.moves.find((x) => x.uci === uci);
  if (!m || !entry) return null;
  const share = m.count / entry.total;
  return share >= 0.005 || (m.count >= 25 && share >= 0.001) ? m : null;
}

/** The line masters most often play from `fen`: the most played move each time, while it's theory. */
export function mainLine(book: MastersBook, fen: string, maxPlies = 8): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (let i = 0; i < maxPlies; i++) {
    const e = book.get(c.fen());
    const top = e?.moves[0];
    if (!top || !isTheory(e, top.uci) || top.count < 3) break;
    try {
      c.move({ from: top.uci.slice(0, 2), to: top.uci.slice(2, 4), promotion: top.uci[4] });
    } catch {
      break;
    }
    out.push(top.uci);
  }
  return out;
}

/**
 * The book ships gzipped (it's mostly hashes and counts, and servers don't compress
 * binary files). Hosts that already decoded it in transit hand back the raw file, so
 * the magic bytes decide.
 */
export async function readMasters(buf: ArrayBuffer): Promise<MastersBook> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(stream).arrayBuffer();
  }
  return parseMasters(buf);
}

/** Where the book is served from (public/data). */
export const MASTERS_URL = "/data/masters-book.bin.gz";

let cached: Promise<MastersBook> | null = null;

/** Fetches the master book the first time a game is reviewed. */
export function loadMasters(): Promise<MastersBook> {
  if (!cached)
    cached = fetch(MASTERS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`master book: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(readMasters)
      .catch((e) => {
        cached = null;
        throw e;
      });
  return cached;
}
