import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

/**
 * Search engines and AI assistants may crawl everything but the API, the private dashboard and
 * a reviewed game's board view (/games/<slug>/review: the app with the review loaded, marked
 * noindex; the game's page is the one for search). Each crawl of a prebuilt page that a region's
 * CDN doesn't hold costs Vercel ISR reads (8 KB each; a board view is ~120 KB).
 * Majestic's backlink crawler (MJ12bot) is kept out: it brings no visitors, and each of its
 * passes over the ~2,000 prebuilt pages costs Vercel ISR reads (1.8k requests on 2026-11-19).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "*", allow: "/", disallow: ["/api/", "/stats", "/games/*/review"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
