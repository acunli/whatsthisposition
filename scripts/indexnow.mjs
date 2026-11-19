// Tells the IndexNow search engines (Bing, Yandex, Seznam, Naver; DuckDuckGo and others search
// Bing's index) that the site's pages changed, so they crawl them soon rather than whenever they
// next pass by. Google doesn't take part: submit the sitemap in Search Console for Google.
//
// It reads the live sitemap, so run it after a deploy (CI does, .github/workflows/indexnow.yml):
//   npm run seo:indexnow [site address] [--dry] [--all] [--days=N]
//     --dry: print what would be sent; --all: every page in the sitemap (only after a change to
//     every page); --days=N: pages whose sitemap lastmod is within the last N days (default 2).
// Only pages that changed are sent, as IndexNow asks. Sending the whole sitemap after every
// deploy (a daily one, sometimes several a day) had the engines recrawl ~2,000 pages each time,
// all of them cache misses on a fresh deployment: that filled Vercel's ISR reads (857K of the
// Hobby plan's 1M in 30 days, 2026-11-19). Pages without a lastmod (the openings, the home page)
// are sent only with --all.
// The key is public by design: public/<key>.txt, holding the key, proves the site is ours.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = readdirSync(join(root, "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) throw new Error("No IndexNow key file (32 hex characters + .txt) in public/.");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const all = args.includes("--all");
const days = Number(args.find((a) => a.startsWith("--days="))?.slice(7) ?? 2);
if (!(days > 0)) throw new Error("--days= takes a number of days above 0.");
const site = (args.find((a) => !a.startsWith("--")) ?? "https://www.whatsthisposition.com").replace(/\/+$/, "");
const host = new URL(site).host;
const keyLocation = `${site}/${key}.txt`;

const live = await fetch(keyLocation);
if (!live.ok || (await live.text()).trim() !== key) throw new Error(`${keyLocation} doesn't serve the key yet (HTTP ${live.status}). Deploy first.`);

const sitemap = await (await fetch(`${site}/sitemap.xml`)).text();
const pages = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)]
  .map((m) => ({ url: /<loc>([^<]+)<\/loc>/.exec(m[1])?.[1], lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1] }))
  .filter((p) => p.url && new URL(p.url).host === host);
if (!pages.length) throw new Error(`No pages on ${host} in ${site}/sitemap.xml.`);
const since = Date.now() - days * 86_400_000;
const urlList = pages.filter((p) => all || (p.lastmod && Date.parse(p.lastmod) >= since)).map((p) => p.url);
const body = JSON.stringify({ host, key, keyLocation, urlList });
// No process.exit() on these paths: it cuts off a long stdout written to a pipe.
if (!urlList.length) console.log(`IndexNow: none of the ${pages.length} pages changed in the last ${days} days; nothing sent.`);
else if (dry) console.log(body);
else {
  const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
  // 200: received; 202: received, key still being checked; 429: too many submissions (try later).
  if (res.status === 200 || res.status === 202) console.log(`IndexNow: ${urlList.length} of ${pages.length} pages of ${host} submitted (HTTP ${res.status}).`);
  else if (res.status === 429) console.warn(`::warning::IndexNow is throttling submissions for ${host} (HTTP 429); the pages will be crawled anyway.`);
  else throw new Error(`IndexNow refused the submission: HTTP ${res.status} ${await res.text()}`);
}
