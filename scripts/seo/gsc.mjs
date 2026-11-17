#!/usr/bin/env node
// Google Search Console, read-only, for the site's own search numbers: what people search to find
// it, which pages they land on, and whether Google has indexed a page. Signs in as a service
// account (a JSON key added as a Restricted user on the property); no packages needed.
//
//   GSC_KEY_FILE=.secrets/gsc-service-account.json GSC_SITE=sc-domain:whatsthisposition.com (in .env.local)
//   node scripts/seo/gsc.mjs sites                       properties the account can read
//   node scripts/seo/gsc.mjs queries [days=90] [rows=250] top queries (clicks, impressions, CTR, position)
//   node scripts/seo/gsc.mjs pages [days=90] [rows=250]   top pages
//   node scripts/seo/gsc.mjs dates [days=90]              clicks and impressions per day
//   node scripts/seo/gsc.mjs pairs [days=90] [rows=1000]  query × page
//   node scripts/seo/gsc.mjs inspect <url> [url…]         index status of pages (URL Inspection API, 2,000 a day)
//   node scripts/seo/gsc.mjs sitemaps                     submitted sitemaps and what Google read from them
//
// Prints JSON. Search Console's data runs about two days behind.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const keyFile = env("GSC_KEY_FILE");
const site = env("GSC_SITE") ?? "sc-domain:whatsthisposition.com";
if (!keyFile) {
  console.error("Set GSC_KEY_FILE (the service account's JSON key) in .env.local.");
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyFile, "utf8"));

const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: key.token_uri, iat: now, exp: now + 3600 });
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key).toString("base64url");
  const r = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${signature}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

const auth = await token();
async function api(url, body) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${auth}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(j.error ?? j)}`);
  return j;
}

const SITE = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}`;
const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

async function analytics(dimensions, days, rowLimit) {
  const j = await api(`${SITE}/searchAnalytics/query`, { startDate: day(Number(days)), endDate: day(0), dimensions, rowLimit: Number(rowLimit), dataState: "all" });
  return (j.rows ?? []).map((r) => ({ ...Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i]])), clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10 }));
}

const [cmd = "sites", ...args] = process.argv.slice(2);
let out;
if (cmd === "sites") out = await api("https://www.googleapis.com/webmasters/v3/sites");
else if (cmd === "queries") out = await analytics(["query"], args[0] ?? 90, args[1] ?? 250);
else if (cmd === "pages") out = await analytics(["page"], args[0] ?? 90, args[1] ?? 250);
else if (cmd === "dates") out = await analytics(["date"], args[0] ?? 90, 1000);
else if (cmd === "pairs") out = await analytics(["query", "page"], args[0] ?? 90, args[1] ?? 1000);
else if (cmd === "sitemaps") out = await api(`${SITE}/sitemaps`);
else if (cmd === "inspect") {
  out = [];
  for (const url of args) {
    const j = await api("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: site });
    const s = j.inspectionResult?.indexStatusResult ?? {};
    out.push({ url, verdict: s.verdict, coverage: s.coverageState, lastCrawl: s.lastCrawlTime, googleCanonical: s.googleCanonical, sitemap: s.sitemap?.length ? "yes" : "no", referringUrls: s.referringUrls?.length ?? 0 });
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
console.log(JSON.stringify(out, null, 2));
