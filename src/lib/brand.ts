/** The site's name and address, in one place. */
export const SITE_NAME = "what’sthisposition";
/** The parts of the wordmark: the second part is drawn in the brand orange. */
export const WORDMARK = ["what’sthis", "position"] as const;
/**
 * The public address, for page metadata, share previews, the sitemap and robots.txt.
 * NEXT_PUBLIC_SITE_URL overrides it. On Vercel it follows the project's production
 * domain: the *.vercel.app address until a custom domain is added, then that domain.
 * It is read at build time, so redeploy after adding a domain.
 */
export const SITE_URL = siteUrl();
export const SITE_TAGLINE = "See what the engine sees";
export const SITE_DESCRIPTION =
  "Free, open-source chess game review and position analysis. Every move is labelled from brilliant to blunder and explained from Stockfish's own lines, right in your browser.";
/** For HTTP headers, which must be plain ASCII. */
export const SITE_ASCII = "whatsthisposition";
/** The public source code (GPL-3.0): linked from the footer and the credits page. */
export const SOURCE_URL = "https://github.com/acunli/whatsthisposition";

function siteUrl(): string {
  const set = process.env.NEXT_PUBLIC_SITE_URL;
  if (set) return set.replace(/\/+$/, "");
  const vercel = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "https://whatsthisposition.com";
}
