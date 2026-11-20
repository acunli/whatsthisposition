// Draws each reviewed game's preview card (src/lib/server/reviewCard.tsx, the same drawing as
// before) into public/cards/<slug>.png before the site is built. The game pages, their link
// previews and the social posts use these files.
//
// Why files and not a Next.js route: on Vercel a prerendered route is read from the ISR cache
// whenever a region's CDN cache doesn't hold it (each deploy starts empty), and every 8 KB read
// counts against the plan's ISR reads. A card is ~87 KB (11 reads) and the game page shows it,
// so each visit, each prefetch of a game page (its payload asks the browser to preload the
// card) and each crawler cost reads. Files in public/ are plain static files: no ISR reads.
//
// A card is drawn again only when its game file or the drawing code is newer than it, so
// `npm run dev` stays quick; a fresh checkout (a Vercel build) draws them all, one process per
// core (~0.3 s a card on one core).
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(root, "content", "games");
const outDir = join(root, "public", "cards");
const bundle = join(root, "node_modules", ".cache", "cards", "render.cjs");

// The drawing code and what it reads: a card older than any of these is drawn again.
const SOURCES = [
  "src/lib/server/reviewCard.tsx",
  "src/lib/review/shareCard.ts",
  "src/lib/review/classGlyphs.ts",
  "src/lib/review/classify.ts",
  "src/lib/brand.ts",
  "scripts/build-cards.mjs",
].map((f) => join(root, f));
const newest = (files) => Math.max(...files.filter(existsSync).map((f) => statSync(f).mtimeMs));

if (!existsSync(gamesDir)) {
  console.log("[cards] no content/games; nothing to draw");
  process.exit(0);
}

// `--shard=i/n`: a child process drawing every n-th game from the i-th.
const shardArg = process.argv.find((a) => a.startsWith("--shard="));
const [shard, shards] = shardArg ? shardArg.slice(8).split("/").map(Number) : [0, 1];

// Bundle the renderer for plain Node (once, in the parent): `@/` paths from tsconfig, JSX, and
// "server-only" (which only guards against client bundles) left out. Packages stay in
// node_modules; CommonJS, as `next` has no ESM export map (`next/og`).
if (!shardArg) {
  mkdirSync(dirname(bundle), { recursive: true });
  await build({
    stdin: {
      contents: 'export { reviewCard } from "@/lib/server/reviewCard"; export { allGames } from "@/lib/server/content";',
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    jsx: "automatic",
    packages: "external",
    outfile: bundle,
    logLevel: "warning",
    plugins: [
      {
        name: "no-server-only",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
        },
      },
    ],
  });
}
const { reviewCard, allGames } = createRequire(import.meta.url)(bundle);

const games = allGames();
const code = newest(SOURCES);
mkdirSync(outDir, { recursive: true });
const stale = games.filter((g) => {
  const file = join(outDir, `${g.slug}.png`);
  return !existsSync(file) || statSync(file).mtimeMs < Math.max(code, newest([join(gamesDir, `${g.slug}.json`)]));
});
const started = Date.now();

if (shardArg) {
  // Shards split the full list (stable while other shards write), then draw their stale cards.
  const mine = new Set(games.filter((_, i) => i % shards === shard));
  for (const g of stale.filter((x) => mine.has(x))) writeFileSync(join(outDir, `${g.slug}.png`), Buffer.from(await (await reviewCard(g.summary)).arrayBuffer()));
  process.exit(0);
}

const n = Math.max(1, Math.min(availableParallelism(), Math.ceil(stale.length / 8)));
const runs = Array.from({ length: stale.length ? n : 0 }, (_, i) =>
  new Promise((done, fail) =>
    spawn(process.execPath, [fileURLToPath(import.meta.url), `--shard=${i}/${n}`], { stdio: "inherit" }).on("exit", (c) => (c === 0 ? done() : fail(new Error(`[cards] shard ${i}/${n} failed (${c})`)))),
  ),
);
await Promise.all(runs);

// Cards of games no longer published.
const keep = new Set(games.map((g) => `${g.slug}.png`));
let removed = 0;
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".png") && !keep.has(f)) {
    rmSync(join(outDir, f));
    removed++;
  }
}

console.log(`[cards] ${stale.length} drawn (${runs.length} processes), ${games.length - stale.length} up to date, ${removed} removed (${((Date.now() - started) / 1000).toFixed(1)} s) -> public/cards`);
