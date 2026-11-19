import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { LANDINGS } from "@/lib/landing";
import { allGames } from "@/lib/server/content";

/**
 * Every indexable page. A last-modified date is given only where it is known: Google trusts
 * `lastmod` only from sitemaps where it is right, and a site redeployed daily (the reviewed games)
 * that stamped every page with the build date would teach it to ignore all of them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const games = allGames();
  const newest = games.reduce((d, g) => (g.published > d ? g.published : d), "");
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...LANDINGS.map((p) => ({ url: `${SITE_URL}${p.path}`, ...(p.updated ? { lastModified: day(p.updated) } : {}), changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${SITE_URL}/credits`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/games`, ...(newest ? { lastModified: day(newest) } : {}), changeFrequency: "daily", priority: 0.7 },
    ...games.map((g) => ({ url: `${SITE_URL}/games/${g.slug}`, lastModified: day(g.published), changeFrequency: "yearly" as const, priority: 0.6 })),
    { url: `${SITE_URL}/puzzles`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
