/**
 * Builds the browser extension into extension/dist: load that folder with "Load
 * unpacked" in chrome://extensions. `--zip` also packs it for the Chrome Web Store.
 *
 * The scripts are bundled from the site's own code (src/lib), so the extension's
 * labels and accuracy are the website's. Stockfish and the opening book ship inside it.
 * EXT_SITE_URL sets the site that "See every move explained" opens (default: the live site).
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "extension", "dist");
const site = (process.env.EXT_SITE_URL ?? "https://whatsthisposition.vercel.app").replace(/\/+$/, "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(join(root, "public", "engine", "stockfish.wasm"))) {
  execFileSync(process.execPath, [join(root, "scripts", "copy-engine.mjs")], { stdio: "inherit" });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { content: "extension/src/content.ts", panel: "extension/src/panel.ts" },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: true,
  legalComments: "eof",
  tsconfig: "tsconfig.json",
  define: {
    // src/lib/brand.ts reads these on the site; here the site is fixed at build time.
    "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(site),
    "process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL": '""',
    "process.env.VERCEL_PROJECT_PRODUCTION_URL": '""',
    "process.env.NODE_ENV": '"production"',
  },
  logOverride: { "module-level-directive": "silent" },
  logLevel: "warning",
});

const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8"));
manifest.version = pkg.version;
manifest.homepage_url = site;
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const f of ["panel.html", "panel.css"]) cpSync(join(root, "extension", f), join(out, f));
// The toolbar popup links to the same site as the card.
writeFileSync(join(out, "popup.html"), readFileSync(join(root, "extension", "popup.html"), "utf8").replace("https://whatsthisposition.vercel.app", site));
cpSync(join(root, "extension", "icons"), join(out, "icons"), { recursive: true });
mkdirSync(join(out, "engine"));
for (const f of ["stockfish.js", "stockfish.wasm", "COPYING.txt"]) cpSync(join(root, "public", "engine", f), join(out, "engine", f));
mkdirSync(join(out, "data"));
cpSync(join(root, "public", "data", "masters-book.bin.gz"), join(out, "data", "masters-book.bin.gz"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

console.log(`Built the extension (v${pkg.version}, site ${site}) in extension/dist`);

if (process.argv.includes("--zip")) {
  const zip = join(root, "extension", `whatsthisposition-extension-${pkg.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out });
  console.log(`Packed ${zip}`);
}
