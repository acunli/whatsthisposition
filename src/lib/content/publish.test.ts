/**
 * The daily job behind /games (.github/workflows/content.yml), in two steps. Skipped unless
 * CONTENT_STEP is set:
 *   CONTENT_STEP=pick [CONTENT_BROADCASTS=4] [CONTENT_ONLINE=3] npx vitest run src/lib/content/publish.test.ts
 *     picks the day's games (src/lib/content/sources.ts) and their page addresses, into
 *     content/candidates.json (not committed);
 *   CONTENT_STEP=review [CONTENT_SHARD=0/4] [CONTENT_DEPTH=18] npx vitest run src/lib/content/publish.test.ts
 *     reviews its share of them exactly as the site does (two passes, the opening book, the
 *     same labels) and writes content/games/<slug>.json, with the explanations of the key
 *     moments from the reasoning engine. Shards run as separate processes: one engine each.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import openings from "@/data/openings.json";
import { findThreat, reasonMove } from "../reason/reason";
import { explainSacrifice } from "../reason/sacrifice";
import { gameAccuracy } from "../review/accuracy";
import { makeBook, type OpeningBook } from "../review/book";
import { REVIEW_DEPTHS, VERIFY_EXTRA } from "../review/depths";
import { explainOpening, explainReviewMove } from "../review/explain";
import { readMasters } from "../review/masters";
import { parseGame } from "../review/pgn";
import { classifyGame, runReview } from "../review/review";
import { packReview, unpackReview } from "../review/share";
import { summarize } from "../review/shareCard";
import type { Searcher } from "../deep/deep";
import { nodeSearcher } from "../eval/nodeEngine";
import { displayName, gameSlug, pageSide, pickMoments, type GameMoment, type GameRecord } from "./games";
import { httpFetch, pickCandidates, type Candidate } from "./sources";

const env = process.env;
const DIR = "content/games";
const CANDIDATES = env.CONTENT_CANDIDATES ?? "content/candidates.json";

const published = (): GameRecord[] =>
  existsSync(DIR)
    ? readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as GameRecord)
    : [];

type Pick = Candidate & { slug: string };

it.skipIf(env.CONTENT_STEP !== "pick")("pick the day's games", async () => {
  const have = published();
  const picks = await pickCandidates(httpFetch, new Set(have.map((r) => r.source.url)), { broadcasts: Number(env.CONTENT_BROADCASTS ?? 4), online: Number(env.CONTENT_ONLINE ?? 3) });
  const taken = new Set(have.map((r) => r.slug));
  const out: Pick[] = picks.map((c) => {
    const g = parseGame(c.pgn);
    const slug = gameSlug(displayName(g.white), displayName(g.black), c.source.event, c.played, taken);
    taken.add(slug);
    return { ...c, slug };
  });
  writeFileSync(CANDIDATES, JSON.stringify(out, null, 1));
  console.log(`${out.length} games picked:\n${out.map((c) => `  ${c.slug}  (${c.rank}, ${c.source.url})`).join("\n")}`);
}, 600_000);

const ERRORS: string[] = ["mistake", "blunder", "miss"];

/** Up to `max` distinct, non-empty sentences. */
const sentences = (list: (string | undefined | null)[], max: number) => [...new Set(list.map((s) => s?.trim()).filter((s): s is string => !!s))].slice(0, max);

async function moment(c: ReturnType<typeof classifyGame>["moves"][number], prev: ReturnType<typeof classifyGame>["moves"][number] | undefined, search: Searcher, depth: number): Promise<GameMoment> {
  const m = c.move;
  const story = explainReviewMove(c, prev);
  const threatBefore = await findThreat(m.fenBefore, search, depth - 2, c.bestLine?.eval ?? c.evalBefore).catch(() => null);
  const rs = await reasonMove({
    fen: m.fenBefore,
    uci: m.uci,
    line: c.replyLine ? { pv: [m.uci, ...c.replyLine.pv], eval: c.evalAfter, depth: c.replyLine.depth } : undefined,
    best: c.bestLine ?? undefined,
    second: c.secondLine ?? undefined,
    search,
    depth,
    threatBefore,
  }).catch(() => null);
  const out: GameMoment = {
    ply: m.ply,
    name: `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`,
    cls: c.cls,
    color: m.color,
    headline: story.headline,
    // An error's own ideas (what it meant to do) can read as praise next to its label, so errors keep
    // the review's verdict, the reply that punishes them and the better move; good moves get the reasoning.
    points: ERRORS.includes(c.cls)
      ? sentences(story.points.map((p) => p.text), 4)
      : sentences([...story.points.map((p) => p.text), rs?.headline, ...(rs?.ideas ?? []).slice(0, 3).map((i) => i.text), rs?.refutation?.text, rs?.line?.text], 6),
  };
  if (c.cls === "brilliant") {
    const sac = await explainSacrifice({
      fen: m.fenBefore,
      uci: m.uci,
      reply: c.replyLine ? { pv: c.replyLine.pv, eval: c.evalAfter, depth: c.replyLine.depth } : undefined,
      best: c.bestLine ?? undefined,
      second: c.secondLine ?? undefined,
      quiet: c.quietLine ?? undefined,
      threatBefore,
      search,
      depth,
    }).catch(() => null);
    if (sac) out.why = [{ title: "The idea", text: sac.headline }, ...sac.steps.map((s) => ({ title: s.title, text: s.text }))];
  }
  if (ERRORS.includes(c.cls) && c.bestUci && c.bestUci !== m.uci && c.bestLine) {
    const b = await reasonMove({ fen: m.fenBefore, uci: c.bestUci, line: c.bestLine, best: c.bestLine, second: c.secondLine ?? undefined, search, depth, threatBefore }).catch(() => null);
    if (b) out.better = sentences([b.headline, b.line?.text], 2).join(" ");
  }
  return out;
}

async function review(c: Pick, search: Searcher, book: OpeningBook, depth: number): Promise<GameRecord> {
  const g = parseGame(c.pgn);
  const positions = await runReview(g, [search], { depth, verifyDepth: depth + VERIFY_EXTRA, book: Promise.resolve(book) });
  const r = classifyGame(g, positions, book);
  const accuracy = gameAccuracy(r.moves);
  const as = pageSide(r.moves, g.result);
  const white = displayName(g.white);
  const black = displayName(g.black);
  const opening = explainOpening(r);
  const moments: GameMoment[] = [];
  for (const m of pickMoments(r.moves)) moments.push(await moment(m, r.moves[m.move.ply - 2], search, Math.min(depth, 16)));
  return {
    v: 1,
    slug: c.slug,
    source: c.source,
    published: new Date().toISOString().slice(0, 10),
    ...(c.played ? { played: c.played } : {}),
    pgn: c.pgn,
    as,
    depth,
    data: await packReview(positions, depth),
    summary: summarize({ ...g, white, black }, r.moves, accuracy, as, r.opening?.name ?? g.opening),
    white,
    black,
    labels: r.moves.map((m) => m.cls),
    moments,
    ...(opening ? { opening: { name: opening.name, eco: opening.eco, points: opening.points.map((p) => p.text) } } : {}),
  };
}

/**
 * After a change to the label rules: labels every published game again from its stored review
 * (no new searches for the labels) and, where they changed, rewrites its labels, summary and key
 * moments (whose explanations need the engine).
 *   CONTENT_STEP=relabel npx vitest run src/lib/content/publish.test.ts
 */
it.skipIf(env.CONTENT_STEP !== "relabel")("label the published games again", async () => {
  const buf = readFileSync("public/data/masters-book.bin.gz");
  const masters = await readMasters(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).catch(() => null);
  const book = makeBook(openings as never, masters);
  let search: Searcher | null = null;
  for (const rec of published()) {
    const stored = await unpackReview(rec.data);
    if (!stored) throw new Error(`${rec.slug}: unreadable review`);
    const g = parseGame(rec.pgn);
    const r = classifyGame(g, stored.positions, book);
    const labels = r.moves.map((m) => m.cls);
    if (labels.join() === rec.labels.join()) continue;
    search ??= await nodeSearcher();
    const moments: GameMoment[] = [];
    for (const m of pickMoments(r.moves)) moments.push(await moment(m, r.moves[m.move.ply - 2], search, Math.min(rec.depth, 16)));
    const summary = summarize({ ...g, white: rec.white, black: rec.black }, r.moves, gameAccuracy(r.moves), rec.as, r.opening?.name ?? g.opening);
    writeFileSync(join(DIR, `${rec.slug}.json`), JSON.stringify({ ...rec, summary, labels, moments }));
    const changed = labels.flatMap((l, i) => (l === rec.labels[i] ? [] : [`${r.moves[i].move.moveNumber}${r.moves[i].move.color === "w" ? "." : "…"}${r.moves[i].move.san} ${rec.labels[i]} → ${l}`]));
    console.log(`${rec.slug}: ${changed.join(", ")}`);
  }
}, 5_400_000);

it.skipIf(env.CONTENT_STEP !== "review")("review and write the picked games", async () => {
  const [shard, of] = (env.CONTENT_SHARD ?? "0/1").split("/").map(Number);
  const picks = (JSON.parse(readFileSync(CANDIDATES, "utf8")) as Pick[]).filter((_, k) => k % of === shard);
  // One of the review's presets, so "Step through every move" shows this review instead of running a new one.
  const depth = Number(env.CONTENT_DEPTH ?? 18);
  if (!REVIEW_DEPTHS.some((d) => d.depth === depth)) throw new Error(`CONTENT_DEPTH must be one of the review depths: ${REVIEW_DEPTHS.map((d) => d.depth).join(", ")}`);
  const search = await nodeSearcher();
  const buf = readFileSync("public/data/masters-book.bin.gz");
  const masters = await readMasters(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).catch(() => null);
  const book = makeBook(openings as never, masters);
  mkdirSync(DIR, { recursive: true });
  for (const c of picks) {
    const t0 = Date.now();
    try {
      const rec = await review(c, search, book, depth);
      writeFileSync(join(DIR, `${rec.slug}.json`), JSON.stringify(rec));
      console.log(`${rec.slug}: ${rec.moments.length} key moments, ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) {
      // One bad game doesn't stop the others.
      console.error(`${c.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
}, 5_400_000);
