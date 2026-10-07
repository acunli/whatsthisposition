#!/usr/bin/env node
// Downloads a Chess.com player's recent games (public PubAPI, no key) for the
// evaluation tools in this folder. Games that Chess.com has reviewed carry its
// own accuracy numbers, which the accuracy fit compares against.
//
//   node scripts/eval/fetch-games.mjs Ay7u scripts/eval/out/games.json [months=3]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [user, out, monthsArg] = process.argv.slice(2);
if (!user || !out) {
  console.error("Usage: node scripts/eval/fetch-games.mjs <chess.com username> <out.json> [months]");
  process.exit(1);
}
const months = Number(monthsArg ?? 3);
const headers = { "User-Agent": "whatsthisposition evaluation (+https://whatsthisposition.com)" };
const get = async (url) => {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
};

const { archives = [] } = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
const games = [];
for (const url of archives.slice(-months)) games.push(...((await get(url)).games ?? []));
const standard = games.filter((g) => g.rules === "chess" && g.pgn);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(standard));
console.log(`${standard.length} games (${standard.filter((g) => g.accuracies).length} with Chess.com accuracies) → ${out}`);
