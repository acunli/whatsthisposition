// Copies the pinned Stockfish.js lite single-threaded WASM build from node_modules
// into public/engine so the browser loads it from our own origin. Nothing is fetched
// from third-party hosts at runtime; the version is pinned by package-lock.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "stockfish");
const outDir = join(root, "public", "engine");

if (!existsSync(pkgDir)) {
  console.warn("[copy-engine] node_modules/stockfish not found; skipping.");
  process.exit(0);
}

const { buildVersion } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const base = `stockfish-${buildVersion}-lite-single`;
mkdirSync(outDir, { recursive: true });

const files = [
  [join(pkgDir, "bin", `${base}.js`), join(outDir, "stockfish.js")],
  [join(pkgDir, "bin", `${base}.wasm`), join(outDir, "stockfish.wasm")],
  [join(pkgDir, "Copying.txt"), join(outDir, "COPYING.txt")],
];
for (const [from, to] of files) copyFileSync(from, to);
console.log(`[copy-engine] Stockfish ${buildVersion} (lite, single-threaded) -> public/engine`);
