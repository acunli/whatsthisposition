/**
 * Where a visitor came from, as one word the usage counter can keep: a search engine, an AI
 * assistant, a community, a store, or "none" (typed in, a bookmark, an app that sends no
 * referrer). Read from the link's `?ref=` / `utm_source=` tag first (the tags our own posts and
 * listings carry), then from the referring page's host. Only the channel's name is counted:
 * never the referring address itself, which can carry a search or a private page.
 */

export const CHANNELS = [
  "none",
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "yandex",
  "ecosia",
  "brave",
  "chatgpt",
  "perplexity",
  "claude",
  "gemini",
  "copilot",
  "reddit",
  "hackernews",
  "youtube",
  "x",
  "bluesky",
  "mastodon",
  "facebook",
  "instagram",
  "discord",
  "chesscom",
  "lichess",
  "github",
  "chromestore",
  "firefoxstore",
  "edgestore",
  "producthunt",
  "email",
  "extension",
  "share",
  "other",
] as const;

export type Channel = (typeof CHANNELS)[number];

/** Hosts by channel, matched on the host or any subdomain of it. Earlier rows win (gemini.google.com before google). */
const HOSTS: [Channel, RegExp][] = [
  ["chromestore", /^(chromewebstore\.google\.com|chrome\.google\.com)$/],
  ["gemini", /^(gemini|bard)\.google\.com$/],
  ["email", /^mail\.google\.com$|^outlook\.(live|office)\.com$|^mail\.yahoo\.com$/],
  ["google", /(^|\.)google\.[a-z.]+$/],
  ["bing", /(^|\.)bing\.com$/],
  ["copilot", /^copilot\.microsoft\.com$/],
  ["edgestore", /^microsoftedge\.microsoft\.com$/],
  ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ["yahoo", /(^|\.)yahoo\.[a-z.]+$/],
  ["yandex", /(^|\.)yandex\.[a-z.]+$|(^|\.)ya\.ru$/],
  ["ecosia", /(^|\.)ecosia\.org$/],
  ["brave", /^search\.brave\.com$/],
  ["chatgpt", /(^|\.)chatgpt\.com$|^chat\.openai\.com$/],
  ["perplexity", /(^|\.)perplexity\.ai$/],
  ["claude", /^claude\.ai$/],
  ["reddit", /(^|\.)reddit\.com$|^redd\.it$/],
  ["hackernews", /^news\.ycombinator\.com$/],
  ["youtube", /(^|\.)youtube\.com$|^youtu\.be$/],
  ["x", /^(x|twitter)\.com$|^t\.co$|\.(x|twitter)\.com$/],
  ["bluesky", /^bsky\.app$|\.bsky\.app$/],
  ["mastodon", /(^|\.)mastodon\.[a-z.]+$|^mstdn\.[a-z.]+$|^chaos\.social$|^fosstodon\.org$/],
  ["facebook", /(^|\.)facebook\.com$|^fb\.com$|^l\.messenger\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["discord", /(^|\.)discord(app)?\.com$/],
  ["chesscom", /(^|\.)chess\.com$/],
  ["lichess", /(^|\.)lichess\.org$/],
  ["github", /(^|\.)github\.com$/],
  ["firefoxstore", /^addons\.mozilla\.org$/],
  ["producthunt", /(^|\.)producthunt\.com$/],
];

const TAGGED = new Set<string>(CHANNELS);

/**
 * The channel of one page load, or null when the visitor came from another page of this site
 * (`ownHost`, with or without "www."). `search` is the page's query string, `referrer` the
 * browser's document.referrer.
 */
export function channelOf(referrer: string, search: string, ownHost: string): Channel | null {
  const q = new URLSearchParams(search);
  const tag = (q.get("ref") ?? q.get("utm_source") ?? "").toLowerCase();
  if (TAGGED.has(tag)) return tag as Channel;
  if (!referrer) return "none";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "other";
  }
  if (url.protocol === "chrome-extension:" || url.protocol === "moz-extension:") return "extension";
  if (url.protocol === "android-app:") return url.hostname.includes(".gm") ? "email" : "other";
  const host = url.hostname.toLowerCase();
  const bare = (h: string) => h.replace(/^www\./, "");
  if (bare(host) === bare(ownHost.toLowerCase())) return null;
  for (const [channel, re] of HOSTS) if (re.test(host)) return channel;
  return "other";
}
