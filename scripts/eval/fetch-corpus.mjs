#!/usr/bin/env node
// Collects games that Chess.com has reviewed (they carry its accuracy numbers) from players of
// every level, for the performance-rating fit (fit-performance.py). Players are sampled from
// the public country lists; each contributes its latest monthly archive.
//
//   node scripts/eval/fetch-corpus.mjs scripts/eval/out/corpus.jsonl [players=1500] [countries=SG,NZ,IE,NO,PT,AR,ZA,PH]
//
// One JSON line per game: time class, both ratings and accuracies, White's score, plies, the
// link. Every 25th game keeps its PGN, for checking this site's own accuracy on the same games.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const [out, playersArg, countriesArg] = process.argv.slice(2);
if (!out) {
  console.error("Usage: node scripts/eval/fetch-corpus.mjs <out.jsonl> [players] [countries]");
  process.exit(1);
}
const WANT = Number(playersArg ?? 1500);
const COUNTRIES = (countriesArg ?? "SG,NZ,IE,NO,PT,AR,ZA,PH").split(",");
const headers = { "User-Agent": "whatsthisposition evaluation (+https://whatsthisposition.com)" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429) {
        await sleep(4000 * (i + 1));
        continue;
      }
      if (r.status === 404 || r.status === 410) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

// A seeded shuffle, so a re-run samples the same players.
function shuffled(list, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SCORE = { win: 1, checkmated: 0, resigned: 0, timeout: 0, abandoned: 0, lose: 0 };
const whiteScore = (g) => (g.white.result === "win" ? 1 : g.black.result === "win" ? 0 : g.white.result in SCORE ? SCORE[g.white.result] : 0.5);
const plies = (pgn) => {
  const body = pgn.slice(pgn.lastIndexOf("]\n") + 1).replace(/\{[^}]*\}/g, " ");
  return (body.match(/(?:^|\s)(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?/g) ?? []).length;
};

mkdirSync(dirname(out), { recursive: true });
const seen = new Set();
if (existsSync(out)) for (const line of readFileSync(out, "utf8").split("\n")) if (line) seen.add(JSON.parse(line).url);

const per = Math.ceil(WANT / COUNTRIES.length);
const players = [];
for (const c of COUNTRIES) {
  const list = (await get(`https://api.chess.com/pub/country/${c}/players`))?.players ?? [];
  players.push(...shuffled(list, 20261115).slice(0, per));
  console.error(`${c}: ${list.length} players listed`);
}

const recent = (url) => {
  const m = url.match(/(\d{4})\/(\d{2})$/);
  return m ? (2026 - Number(m[1])) * 12 + (11 - Number(m[2])) <= 8 : false;
};

let done = 0;
let kept = 0;
let n = 0;
async function worker(queue) {
  for (;;) {
    const user = queue.pop();
    if (!user) return;
    const archives = (await get(`https://api.chess.com/pub/player/${user}/games/archives`))?.archives ?? [];
    for (const url of archives.slice(-2).filter(recent)) {
      for (const g of (await get(url))?.games ?? []) {
        if (g.rules !== "chess" || !g.accuracies || !g.pgn || seen.has(g.url)) continue;
        if (g.accuracies.white == null || g.accuracies.black == null) continue;
        seen.add(g.url);
        const row = {
          url: g.url,
          tc: g.time_class,
          control: g.time_control,
          rated: !!g.rated,
          w: g.white.rating,
          b: g.black.rating,
          aw: g.accuracies.white,
          ab: g.accuracies.black,
          score: whiteScore(g),
          plies: plies(g.pgn),
          end: g.end_time,
          ...(n++ % 25 === 0 ? { pgn: g.pgn } : {}),
        };
        appendFileSync(out, JSON.stringify(row) + "\n");
        kept++;
      }
    }
    if (++done % 100 === 0) console.error(`${done} players, ${kept} reviewed games`);
  }
}
const queue = shuffled(players, 7);
await Promise.all(Array.from({ length: 3 }, () => worker(queue)));
console.error(`${done} players, ${kept} reviewed games → ${out}`);
