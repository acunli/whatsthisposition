import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

/**
 * Search engines and AI assistants may crawl everything but the API and the private dashboard.
 * Majestic's backlink crawler (MJ12bot) is kept out: it brings no visitors, and each of its
 * passes over the ~2,000 prebuilt pages costs Vercel ISR reads (1.8k requests on 2026-11-19).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "*", allow: "/", disallow: ["/api/", "/stats"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
