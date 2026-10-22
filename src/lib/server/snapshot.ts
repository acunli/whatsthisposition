import "server-only";

/**
 * The numbers outside the site that say how it's doing, read once a day (src/app/api/cron/usage):
 * the extension's users and rating from its public Chrome Web Store page, and the code's stars,
 * forks and watchers from GitHub's public API. Neither needs a key.
 */
import { EXTENSION_URL, SOURCE_URL } from "../brand";
import { allGames } from "./content";
import type { Snapshot } from "./usage";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const count = (s: string | undefined) => (s ? Number(s.replace(/[,.\s]/g, "")) : NaN);

/** Users, rating and number of ratings, from the store page's text ("13 users", "5 out of 5", "3 ratings"). */
export function readStorePage(html: string): Snapshot["store"] | undefined {
  const users = count(/>\s*([\d,.]+)\s+users?\s*</.exec(html)?.[1] ?? /([\d,]+) users?\b/.exec(html)?.[1]);
  if (!Number.isFinite(users)) return undefined;
  const rating = Number(/([\d.]+) out of 5/.exec(html)?.[1]);
  const ratings = count(/([\d,]+) ratings?\b/.exec(html)?.[1]);
  return { users, rating: Number.isFinite(rating) ? rating : null, ratings: Number.isFinite(ratings) ? ratings : null };
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": BROWSER, accept }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Today's outside numbers; any source that doesn't answer is left out. */
export async function takeSnapshot(day: string): Promise<Snapshot> {
  const repo = new URL(SOURCE_URL).pathname.replace(/^\/|\/$/g, "");
  const [page, gh] = await Promise.all([fetchText(EXTENSION_URL, "text/html"), fetchText(`https://api.github.com/repos/${repo}`, "application/vnd.github+json")]);
  const snap: Snapshot = { day, games: allGames().length };
  const store = page ? readStorePage(page) : undefined;
  if (store) snap.store = store;
  if (gh) {
    try {
      const r = JSON.parse(gh) as { stargazers_count?: number; forks_count?: number; subscribers_count?: number; open_issues_count?: number };
      if (typeof r.stargazers_count === "number") snap.github = { stars: r.stargazers_count, forks: r.forks_count ?? 0, watchers: r.subscribers_count ?? 0, issues: r.open_issues_count ?? 0 };
    } catch {
      // left out
    }
  }
  return snap;
}
