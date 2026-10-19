// Tells the IndexNow search engines (Bing, Yandex, Seznam, Naver; DuckDuckGo and others search
// Bing's index) that the site's pages changed, so they crawl them soon rather than whenever they
// next pass by. Google doesn't take part: submit the sitemap in Search Console for Google.
//
// It reads the live sitemap, so run it after a deploy (CI does, .github/workflows/indexnow.yml):
//   npm run seo:indexnow [site address] [--dry]   (--dry: print what would be sent)
// The key is public by design: public/<key>.txt, holding the key, proves the site is ours.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = readdirSync(join(root, "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) throw new Error("No IndexNow key file (32 hex characters + .txt) in public/.");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const site = (args.find((a) => !a.startsWith("--")) ?? "https://www.whatsthisposition.com").replace(/\/+$/, "");
const host = new URL(site).host;
const keyLocation = `${site}/${key}.txt`;

const live = await fetch(keyLocation);
if (!live.ok || (await live.text()).trim() !== key) throw new Error(`${keyLocation} doesn't serve the key yet (HTTP ${live.status}). Deploy first.`);

const sitemap = await (await fetch(`${site}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => new URL(u).host === host);
if (!urlList.length) throw new Error(`No pages on ${host} in ${site}/sitemap.xml.`);

const body = JSON.stringify({ host, key, keyLocation, urlList });
if (dry) {
  console.log(body);
  process.exit(0);
}
const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
// 200: received; 202: received, key still being checked; 429: too many submissions (try later).
if (res.status === 200 || res.status === 202) console.log(`IndexNow: ${urlList.length} pages of ${host} submitted (HTTP ${res.status}).`);
else if (res.status === 429) console.warn(`::warning::IndexNow is throttling submissions for ${host} (HTTP 429); the pages will be crawled anyway.`);
else throw new Error(`IndexNow refused the submission: HTTP ${res.status} ${await res.text()}`);
