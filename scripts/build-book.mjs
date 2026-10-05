#!/usr/bin/env node
/**
 * Builds the master opening book (public/data/masters-book.bin.gz) from games between
 * strong players:
 *   - Lichess broadcasts: over-the-board games, CC BY-SA 4.0 (database.lichess.org, lichess_db_broadcast_*.pgn.zst)
 *   - the Lichess Elite Database: online games, 2500+ vs 2300+, no bullet, from the CC0
 *     Lichess database (database.nikonoel.fr, lichess_elite_*.zip)
 *
 *   node scripts/build-book.mjs public/data/masters-book.bin.gz lichess_db_broadcast_*.pgn.zst lichess_elite_*.zip
 *
 * The shipped book (2026-10-06): 12 months of broadcasts (2025-10 to 2026-09) and six
 * months of the Elite Database (2025-06 to 2025-11): 1.84M games, 140k positions, 2.8 MB.
 * See scripts/eval/README.md for checking how far games stay in book.
 *
 * Games are kept when both players are rated at least MIN_ELO. For each of the first
 * MAX_PLY plies we record the position (placement + side to move, the same key as
 * src/lib/review/positionKey.ts), the move and the game's result. Positions seen in
 * at least MIN_POS games and reachable from the start through theory moves (played at
 * least MIN_MOVE times and by 0.5% of the games, or 25 games and 0.1%) are written
 * out, each with up to MAX_MOVES of those moves.
 *
 * Moves are replayed by scripts/lib/san-replay.mjs, about 40 times faster than chess.js
 * (check it with `--check file.pgn.zst [games]`). Files are read in parallel, one worker
 * per file, and the records are partitioned into buckets on disk, so memory stays small
 * however many games go in. About 1.5 minutes for the shipped book when run in the
 * foreground. Needs the `zstd` and `unzip` command-line tools.
 *
 * Binary format v2 (little-endian), parsed by src/lib/review/masters.ts:
 *   "WTPB" · u8 version (2) · u8 maxPly · u16 minElo · u32 games · u32 positions
 *   per position, sorted by 48-bit key: u32 keyLo · u16 keyHi · u32 total · u8 nMoves
 *     per move: u16 code (from<<9 | to<<3 | promo) · u24 count · u8 white-win % · u8 draw %
 */
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { Replay } from "./lib/san-replay.mjs";

const MIN_ELO = Number(process.env.MIN_ELO ?? 2000);
const MAX_PLY = Number(process.env.MAX_PLY ?? 32);
const MIN_POS = Number(process.env.MIN_POS ?? 20);
const MIN_MOVE = Number(process.env.MIN_MOVE ?? 3);
const MAX_MOVES = Number(process.env.MAX_MOVES ?? 12);
const BUCKETS = 64;
const REC = 10; // u32 keyLo · u32 (keyHi | result << 24) · u16 code

/** cyrb53 as a 53-bit number; must match hash53() in src/lib/review/positionKey.ts. */
function hash53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The 48 bits of a key the book file stores. */
const key48 = (k) => (k % 4294967296) + (Math.floor(k / 4294967296) & 0xffff) * 4294967296;

/** Must match isTheory() in src/lib/review/masters.ts (the MIN_MOVE floor is applied here, when writing). */
const T_SHARE = Number(process.env.T_SHARE ?? 0.005);
const T_COUNT = Number(process.env.T_COUNT ?? 25);
const T_COUNT_SHARE = Number(process.env.T_COUNT_SHARE ?? 0.001);
const isTheory = (count, total) => count >= MIN_MOVE && (count / total >= T_SHARE || (count >= T_COUNT && count / total >= T_COUNT_SHARE));

if (isMainThread) await main();
else await work(workerData);

// ---- Worker: replay one file's games into bucket files. ------------------------------------------
/** Main-line SAN tokens: comments, variations, NAGs, move numbers, results and !? marks removed. */
function sans(movetext) {
  let t = movetext.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  for (let i = 0; i < 6 && t.includes("("); i++) t = t.replace(/\([^()]*\)/g, " ");
  return t
    .split(/\s+/)
    .map((x) => x.replace(/^\d+\.+/, "").replace(/[!?]+$/, ""))
    .filter((x) => x && !/^\$\d+$/.test(x) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x) && !/^\d+\.*$/.test(x));
}

/** Calls `handle(headers, movetext)` for every game in a .pgn.zst or .zip file. */
async function eachGame(file, handle) {
  const [cmd, args] = file.endsWith(".zip") ? ["unzip", ["-p", file]] : file.endsWith(".zst") ? ["zstd", ["-dc", file]] : ["cat", [file]];
  const z = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
  const rl = createInterface({ input: z.stdout, crlfDelay: Infinity });
  let headers = {};
  let moves = [];
  let inMoves = false;
  let stop = false;
  const flush = () => {
    if (moves.length && handle(headers, moves.join(" ")) === false) stop = true;
    headers = {};
    moves = [];
    inMoves = false;
  };
  for await (const line of rl) {
    if (line.startsWith("[")) {
      if (inMoves) flush();
      if (stop) break;
      const m = line.match(/^\[(\w+)\s+"(.*)"\]$/);
      if (m) headers[m[1]] = m[2];
    } else if (line.trim()) {
      inMoves = true;
      moves.push(line);
    }
  }
  if (!stop) flush();
  z.kill();
}

async function work({ file, idx, dir }) {
  const RESULT = { "1-0": 0, "1/2-1/2": 1, "0-1": 2 };
  const fds = Array.from({ length: BUCKETS }, (_, b) => openSync(join(dir, `w${idx}-b${b}.bin`), "w"));
  const bufs = Array.from({ length: BUCKETS }, () => Buffer.alloc(1 << 20));
  const used = new Array(BUCKETS).fill(0);
  const flushBucket = (b) => {
    if (used[b]) writeSync(fds[b], bufs[b], 0, used[b]);
    used[b] = 0;
  };
  let seen = 0;
  let kept = 0;

  const handle = (h, movetext) => {
    seen++;
    if (h.FEN || (h.Variant && h.Variant !== "Standard")) return;
    if (!(Number(h.WhiteElo) >= MIN_ELO && Number(h.BlackElo) >= MIN_ELO)) return;
    const res = RESULT[h.Result];
    if (res === undefined) return;
    const tokens = sans(movetext).slice(0, MAX_PLY);
    if (tokens.length < 4) return;
    const c = new Replay();
    let any = false;
    for (const t of tokens) {
      const key = hash53(c.key());
      const m = c.move(t);
      if (!m) break;
      const lo = key % 4294967296;
      const hi = Math.floor(key / 4294967296);
      const b = lo & (BUCKETS - 1);
      if (used[b] + REC > bufs[b].length) flushBucket(b);
      const o = used[b];
      bufs[b].writeUInt32LE(lo, o);
      bufs[b].writeUInt32LE((hi | (res << 24)) >>> 0, o + 4);
      bufs[b].writeUInt16LE((m.from << 9) | (m.to << 3) | m.promo, o + 8);
      used[b] += REC;
      any = true;
    }
    if (any) kept++;
  };

  await eachGame(file, handle);
  for (let b = 0; b < BUCKETS; b++) {
    flushBucket(b);
    closeSync(fds[b]);
  }
  parentPort.postMessage({ seen, kept });
}

// ---- Main: run the workers, then aggregate bucket by bucket. ------------------------------------
/** --check file [n]: replays n games with both chess.js and the fast replayer and compares every ply. */
async function check(file, n) {
  const require = createRequire(import.meta.url);
  const { Chess } = require("chess.js");
  const FILES = "abcdefgh";
  const sq = (s) => FILES.indexOf(s[0]) + 8 * (Number(s[1]) - 1);
  const PROMO = { "": 0, n: 1, b: 2, r: 3, q: 4 };
  let games = 0;
  let plies = 0;
  let bad = 0;
  await eachGame(file, (h, movetext) => {
    if (h.FEN) return;
    const c = new Chess();
    const r = new Replay();
    for (const t of sans(movetext)) {
      const f = c.fen();
      if (f.slice(0, f.indexOf(" ") + 2) !== r.key()) {
        bad++;
        console.log(`key differs before ${t} in ${h.Site ?? h.LichessURL ?? games}`);
        break;
      }
      let m;
      try {
        m = c.move(t);
      } catch {
        m = null;
      }
      const x = r.move(t);
      if (!m || !x) {
        if (!!m !== !!x) {
          bad++;
          console.log(`${m ? "replayer" : "chess.js"} rejected ${t} in ${h.Site ?? h.LichessURL ?? games}`);
        }
        break;
      }
      if (((sq(m.from) << 9) | (sq(m.to) << 3) | PROMO[m.promotion ?? ""]) !== ((x.from << 9) | (x.to << 3) | x.promo)) {
        bad++;
        console.log(`move differs at ${t} in ${h.Site ?? h.LichessURL ?? games}`);
        break;
      }
      plies++;
    }
    return ++games < n;
  });
  console.log(`checked ${games} games, ${plies} plies: ${bad} differences`);
  process.exit(bad ? 1 : 0);
}

async function main() {
  if (process.argv[2] === "--check") return check(process.argv[3], Number(process.argv[4] ?? 2000));
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || !inputs.length) {
    console.error("Usage: node scripts/build-book.mjs out.bin month.pgn.zst|month.zip [...]");
    process.exit(1);
  }
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "wtp-book-"));
  const queue = inputs.map((file, idx) => ({ file, idx }));
  let seen = 0;
  let kept = 0;
  const run = async () => {
    while (queue.length) {
      const job = queue.shift();
      const r = await new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { ...job, dir } });
        w.once("message", resolve);
        w.once("error", reject);
      });
      seen += r.seen;
      kept += r.kept;
      console.log(`  ${job.file.split("/").pop()}: ${r.kept} of ${r.seen} games kept (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(inputs.length, Math.max(1, availableParallelism() - 1)) }, run));
  console.log(`read: ${kept} games kept of ${seen}`);

  const entries = [];
  const files = readdirSync(dir);
  for (let b = 0; b < BUCKETS; b++) {
    const parts = files.filter((f) => f.endsWith(`-b${b}.bin`)).map((f) => readFileSync(join(dir, f)));
    const count = new Map();
    for (const d of parts)
      for (let o = 0; o < d.length; o += REC) {
        const k = d.readUInt32LE(o) + (d.readUInt32LE(o + 4) & 0xffffff) * 4294967296;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    const stats = new Map();
    for (const [k, n] of count) if (n >= MIN_POS) stats.set(k, { total: n, moves: new Map() });
    count.clear();
    for (const d of parts)
      for (let o = 0; o < d.length; o += REC) {
        const w = d.readUInt32LE(o + 4);
        const s = stats.get(d.readUInt32LE(o) + (w & 0xffffff) * 4294967296);
        if (!s) continue;
        const code = d.readUInt16LE(o + 8);
        let mv = s.moves.get(code);
        if (!mv) s.moves.set(code, (mv = [0, 0, 0, 0]));
        mv[0]++;
        mv[1 + (w >>> 24)]++;
      }
    for (const [k, s] of stats) entries.push([key48(k), s]);
  }
  rmSync(dir, { recursive: true, force: true });

  // ---- Keep what a review can reach: positions reached from the start through theory moves. ----
  // The review stops looking at the book after the first move that isn't theory, so nothing else
  // is ever looked up; dropping it (and the moves that aren't theory) loses nothing.
  const byKey = new Map(entries);
  const reach = new Map();
  const visited = new Set();
  const stack = [new Replay()];
  while (stack.length) {
    const r = stack.pop();
    const k = key48(hash53(r.key()));
    if (visited.has(k)) continue;
    visited.add(k);
    const s = byKey.get(k);
    if (!s) continue;
    const moves = [...s.moves.entries()]
      .filter(([, v]) => isTheory(v[0], s.total))
      .sort((a, b) => b[1][0] - a[1][0])
      .slice(0, MAX_MOVES);
    reach.set(k, { total: s.total, moves });
    for (const [code] of moves) {
      const c = r.clone();
      c.play(code >> 9, (code >> 3) & 63, code & 7);
      stack.push(c);
    }
  }
  console.log(`reachable through theory: ${reach.size} of ${entries.length} positions`);
  const out2 = [...reach.entries()];

  // ---- Write. ---------------------------------------------------------------------------------
  out2.sort((a, b) => a[0] - b[0]);
  const chunks = [];
  const head = Buffer.alloc(16);
  head.write("WTPB", 0, "latin1");
  head.writeUInt8(2, 4);
  head.writeUInt8(MAX_PLY, 5);
  head.writeUInt16LE(MIN_ELO, 6);
  head.writeUInt32LE(kept, 8);
  head.writeUInt32LE(out2.length, 12);
  chunks.push(head);
  let moveCount = 0;
  for (const [key, s] of out2) {
    const moves = s.moves;
    const buf = Buffer.alloc(11 + moves.length * 7);
    buf.writeUInt32LE(key % 4294967296, 0);
    buf.writeUInt16LE(Math.floor(key / 4294967296), 4);
    buf.writeUInt32LE(s.total, 6);
    buf.writeUInt8(moves.length, 10);
    moves.forEach(([code, v], i) => {
      const o = 11 + i * 7;
      buf.writeUInt16LE(code, o);
      buf.writeUIntLE(Math.min(v[0], 0xffffff), o + 2, 3);
      buf.writeUInt8(Math.round((100 * v[1]) / v[0]), o + 5);
      buf.writeUInt8(Math.round((100 * v[2]) / v[0]), o + 6);
    });
    moveCount += moves.length;
    chunks.push(buf);
  }
  const outBuf = Buffer.concat(chunks);
  // The app fetches the gzipped file (servers don't compress binary files).
  writeFileSync(out, out.endsWith(".gz") ? gzipSync(outBuf, { level: 9 }) : outBuf);
  console.log(`wrote ${out}: ${out2.length} positions, ${moveCount} moves, ${(outBuf.length / 1024).toFixed(0)} KB from ${kept} games (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
