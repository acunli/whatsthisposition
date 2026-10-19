// Posts the newest reviewed games (content/games) to the site's own social accounts, at most
// SOCIAL_MAX (default 2) per run, the most striking first: a Brilliant move, then a Great one,
// then the strongest pairing. Each platform runs only when its secrets are set, and checks its
// own recent posts first, so a game is never posted twice (.github/workflows/social.yml).
//
//   Bluesky:  BLUESKY_HANDLE, BLUESKY_APP_PASSWORD (an app password, not the account's)
//   Mastodon: MASTODON_INSTANCE (https://mastodon.social), MASTODON_TOKEN (scope write:statuses)
//
//   node scripts/social/post.mjs [--dry]   (--dry: print what would be posted)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.env.SITE_URL ?? "https://www.whatsthisposition.com").replace(/\/+$/, "");
const dry = process.argv.includes("--dry");
const max = Number(process.env.SOCIAL_MAX ?? 2);
const DAY = 86_400_000;

const dir = join(root, "content/games");
const games = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .filter((g) => Date.parse(`${g.published}T00:00:00Z`) >= Date.now() - 3 * DAY);

const score = (g) => (g.summary.moment?.cls === "brilliant" ? 2 : g.summary.moment ? 1 : 0);
const strength = (g) => Math.min(Number(g.summary.whiteElo) || 0, Number(g.summary.blackElo) || 0);
games.sort((a, b) => score(b) - score(a) || strength(b) - strength(a) || b.published.localeCompare(a.published));

const acc = (n) => (n == null ? "–" : n.toFixed(1));
const event = (g) => g.source.event.replace(/\s*\|\s*/g, ", ");
const link = (g, ref) => `${SITE}/games/${g.slug}?ref=${ref}`;

/** The post's words (Bluesky allows 300 characters; the link travels as a card, not in the text). */
function words(g) {
  const s = g.summary;
  const me = s.as === "w" ? g.white : g.black;
  const them = s.as === "w" ? g.black : g.white;
  const lead = s.moment
    ? `${s.moment.name}${s.moment.cls === "brilliant" ? "!!" : "!"} ${s.moment.cls === "brilliant" ? "A Brilliant move" : "A Great move"} by ${me} against ${them}`
    : `${g.white} vs ${g.black}`;
  const full = `${lead} (${event(g)}). Accuracy ${g.white} ${acc(s.accuracy.w)}, ${g.black} ${acc(s.accuracy.b)}. Every move labelled and explained by Stockfish 19.`;
  // Long names or events: drop the last sentence, then the event, to stay well under 300.
  if ([...full].length <= 280) return full;
  const shorter = `${lead} (${event(g)}). Accuracy ${g.white} ${acc(s.accuracy.w)}, ${g.black} ${acc(s.accuracy.b)}.`;
  return [...shorter].length <= 280 ? shorter : `${lead}. Accuracy ${acc(s.accuracy.w)} and ${acc(s.accuracy.b)}.`.slice(0, 280);
}

async function bluesky(list) {
  const { BLUESKY_HANDLE: id, BLUESKY_APP_PASSWORD: pw } = process.env;
  if (!id || !pw) return console.log("Bluesky: no BLUESKY_HANDLE / BLUESKY_APP_PASSWORD, skipped.");
  const api = "https://bsky.social/xrpc";
  const call = async (method, body, token, type = "application/json") => {
    const r = await fetch(`${api}/${method}`, { method: "POST", headers: { "Content-Type": type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: type === "application/json" ? JSON.stringify(body) : body });
    if (!r.ok) throw new Error(`Bluesky ${method}: HTTP ${r.status} ${await r.text()}`);
    return r.json();
  };
  const session = await call("com.atproto.server.createSession", { identifier: id, password: pw });
  const feed = await (await fetch(`${api}/app.bsky.feed.getAuthorFeed?actor=${session.did}&limit=50`, { headers: { Authorization: `Bearer ${session.accessJwt}` } })).json();
  const posted = new Set((feed.feed ?? []).map((f) => f.post?.record?.embed?.external?.uri ?? "").filter(Boolean).map((u) => new URL(u).pathname));
  let n = 0;
  for (const g of list) {
    if (n >= max) break;
    if (posted.has(`/games/${g.slug}`)) continue;
    const text = `${words(g)} #chess`;
    const tag = text.lastIndexOf("#chess");
    const bytes = (s) => new TextEncoder().encode(s).length;
    const uri = link(g, "bluesky");
    const title = `${g.white} vs ${g.black}: game review`;
    if (dry) {
      console.log(`Bluesky would post: ${text}\n  card: ${title} ${uri}`);
      n++;
      continue;
    }
    const img = await fetch(`${SITE}/games/${g.slug}/opengraph-image`);
    const thumb = img.ok ? (await call("com.atproto.repo.uploadBlob", Buffer.from(await img.arrayBuffer()), session.accessJwt, "image/png")).blob : undefined;
    await call(
      "com.atproto.repo.createRecord",
      {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          createdAt: new Date().toISOString(),
          langs: ["en"],
          facets: [{ index: { byteStart: bytes(text.slice(0, tag)), byteEnd: bytes(text.slice(0, tag)) + bytes("#chess") }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "chess" }] }],
          embed: { $type: "app.bsky.embed.external", external: { uri, title, description: "Both accuracies, every Brilliant move explained, every mistake shown.", ...(thumb ? { thumb } : {}) } },
        },
      },
      session.accessJwt,
    );
    console.log(`Bluesky: posted ${g.slug}`);
    n++;
  }
  if (!n) console.log("Bluesky: nothing new to post.");
}

async function mastodon(list) {
  const { MASTODON_INSTANCE: base, MASTODON_TOKEN: token } = process.env;
  if (!base || !token) return console.log("Mastodon: no MASTODON_INSTANCE / MASTODON_TOKEN, skipped.");
  const api = base.replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${token}` };
  const me = await (await fetch(`${api}/api/v1/accounts/verify_credentials`, { headers: auth })).json();
  if (!me.id) throw new Error("Mastodon: the token doesn't work (verify_credentials).");
  const recent = await (await fetch(`${api}/api/v1/accounts/${me.id}/statuses?limit=40`, { headers: auth })).json();
  const posted = (Array.isArray(recent) ? recent : []).map((s) => s.content ?? "").join("\n");
  let n = 0;
  for (const g of list) {
    if (n >= max) break;
    if (posted.includes(`/games/${g.slug}`)) continue;
    const status = `${words(g)}\n\n${link(g, "mastodon")}\n\n#chess`;
    if (dry) {
      console.log(`Mastodon would post: ${status}`);
      n++;
      continue;
    }
    const r = await fetch(`${api}/api/v1/statuses`, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": g.slug }, body: JSON.stringify({ status, language: "en", visibility: "public" }) });
    if (!r.ok) throw new Error(`Mastodon: HTTP ${r.status} ${await r.text()}`);
    console.log(`Mastodon: posted ${g.slug}`);
    n++;
  }
  if (!n) console.log("Mastodon: nothing new to post.");
}

if (!games.length) console.log("No games reviewed in the last three days.");
else if (dry) {
  // What the next run would post, without logging in anywhere.
  for (const g of games.slice(0, max)) console.log(`${words(g)} #chess\n  ${link(g, "bluesky")}\n`);
} else {
  const results = await Promise.allSettled([bluesky(games), mastodon(games)]);
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error(f.reason);
  if (failed.length) process.exit(1);
}
