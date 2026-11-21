// Draws the home page's strip of flags (src/components/home/Flags.tsx): the countries and
// territories people have used the site from, side by side in one SVG file.
//
// Why one file: the strip is a CSS background that repeats and slides, so the home page's HTML
// carries no flags (it is prerendered, and every 8 KB of it read from the ISR cache counts against
// the plan; see build-cards.mjs) and a visitor's browser asks for one file, kept for a week. Its
// name carries a hash of its content, so a new list gets a new address.
//
// The list is src/data/countries-seen.json (ISO 3166 codes, most visits first). This script
// rewrites that file's `strip`, `flags` and `countries` (the number the page states), and with
// --stats it first refreshes the codes from the usage counter (/stats, every visit since
// 2026-10-14), with STATS_PASSWORD from the environment or .env.local:
//
//   node scripts/build-flags.mjs --stats   # refresh the list, then draw
//   node scripts/build-flags.mjs           # draw the strip from the list as it is
//
// The output is committed (the build doesn't run this). Flags: the 3:2 set of country-flag-icons
// (MIT, a devDependency).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listFile = join(root, "src", "data", "countries-seen.json");
const outDir = join(root, "public", "flags");
const flagDir = join(root, "node_modules", "country-flag-icons", "3x2");
const site = process.env.STATS_URL || "https://www.whatsthisposition.com";

// One flag's box in the strip, in CSS pixels at the strip's natural height (the page scales it):
// a 3:2 flag and the gap after it. Flags.tsx and the home page's CSS use the same numbers.
const H = 28;
const W = 42;
const GAP = 22;
const RADIUS = 3;

// Codes with a flag of their own that aren't countries: shown in the strip, left out of the
// number the page states ("over 90 countries").
const NOT_COUNTRIES = new Set(
  "AS AI AW AX BL BM BQ CC CK CW CX EH EU FK FO GF GG GI GL GP GU HK IM IO JE KY MF MO MP MQ MS NC NF NU PF PM PN PR RE SH SJ SX TC TK VG VI WF YT".split(" "),
);

const hasFlag = (code) => /^[A-Z]{2}$/.test(code) && code !== "EU" && existsSync(join(flagDir, `${code}.svg`));

if (!existsSync(flagDir)) {
  console.error("[flags] country-flag-icons isn't installed (npm install)");
  process.exit(1);
}

const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : { codes: [] };

if (process.argv.includes("--stats")) {
  list.codes = await fromStats();
  list.updated = new Date().toISOString().slice(0, 10);
}

const codes = list.codes.filter(hasFlag);
if (!codes.length) {
  console.error("[flags] no countries in the list; run with --stats");
  process.exit(1);
}

const svg = strip(codes);
const hash = createHash("sha256").update(svg).digest("hex").slice(0, 10);
const name = `strip-${hash}.svg`;
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.startsWith("strip-") && f !== name) rmSync(join(outDir, f));
writeFileSync(join(outDir, name), svg);

const out = {
  updated: list.updated,
  countries: codes.filter((c) => !NOT_COUNTRIES.has(c)).length,
  flags: codes.length,
  strip: `/flags/${name}`,
  codes,
};
writeFileSync(listFile, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[flags] ${codes.length} flags (${out.countries} countries) → public/flags/${name} (${(svg.length / 1024).toFixed(1)} KB)`);

/** The flags in a row, each clipped to rounded corners with a faint edge (white flags on a light page). */
function strip(list) {
  const flags = list.map((code, i) => {
    const src = readFileSync(join(flagDir, `${code}.svg`), "utf8").trim();
    const open = src.match(/^<svg\b[^>]*>/)[0];
    const viewBox = open.match(/viewBox="([^"]+)"/)[1];
    const body = src.slice(open.length, src.lastIndexOf("</svg>"));
    return (
      `<g transform="translate(${i * (W + GAP)})" clip-path="url(#r)">` +
      `<svg width="${W}" height="${H}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice">${body}</svg>` +
      `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${RADIUS - 0.5}" fill="none" stroke="#000" stroke-opacity=".14"/>` +
      `</g>`
    );
  });
  const width = list.length * (W + GAP);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">` +
    `<clipPath id="r"><rect width="${W}" height="${H}" rx="${RADIUS}"/></clipPath>` +
    flags.join("") +
    `</svg>\n`
  );
}

/** Every country the usage counter has seen, most visits first. */
async function fromStats() {
  const pw = process.env.STATS_PASSWORD || readEnvLocal("STATS_PASSWORD");
  if (!pw) throw new Error("STATS_PASSWORD isn't set (environment or .env.local)");
  const res = await fetch(`${site}/stats/export?kind=counts&range=all`, {
    headers: { authorization: `Basic ${Buffer.from(`x:${pw}`).toString("base64")}` },
  });
  if (!res.ok) throw new Error(`/stats/export answered ${res.status}`);
  // Rows "day,field,count"; a visit's place is the field "g|<country>|…".
  const visits = new Map();
  for (const line of (await res.text()).split("\n").slice(1)) {
    const [, field, count] = line.split(",");
    if (!field?.startsWith("g|")) continue;
    const code = field.split("|")[1];
    visits.set(code, (visits.get(code) ?? 0) + Number(count));
  }
  return [...visits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
}

function readEnvLocal(key) {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : null;
}
