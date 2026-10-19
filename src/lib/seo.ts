/**
 * What pages tell search engines: their metadata and structured data (schema.org JSON-LD).
 * The home page's own graph is in app/page.tsx; the landing pages (lib/landing.ts) use these.
 */
import type { Metadata } from "next";
import { EXTENSION_URL, SITE_NAME, SITE_URL } from "./brand";
import type { FaqItem } from "./faq";
import type { Landing } from "./landing";

/** The social preview every page shares (1200×630). */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME}: free chess game review, every move explained` };

/**
 * A landing page's metadata. Next.js replaces (doesn't merge) the layout's openGraph and twitter
 * objects, so they're given in full.
 */
export function landingMetadata(p: Landing): Metadata {
  const title = `${p.title} · ${SITE_NAME}`;
  return {
    title: { absolute: title },
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: { type: "website", url: p.path, siteName: SITE_NAME, title, description: p.description, locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description: p.description, images: [OG_IMAGE.url] },
  };
}

export function faqPage(items: FaqItem[], url: string) {
  return {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: items.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

/** The Chess.com extension, as a browser application. */
export const EXTENSION_APP = {
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#extension`,
  name: `${SITE_NAME} for Chess.com`,
  url: EXTENSION_URL,
  description: "A browser extension that reviews a finished Chess.com game on its page: both players' accuracy and every move labelled, from Brilliant to Blunder.",
  applicationCategory: "BrowserApplication",
  operatingSystem: "Chrome, Edge, Brave and other Chromium browsers on Windows, macOS, Linux and ChromeOS",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "Ayushman Chaudhuri", url: "https://ayushman.rocks" },
};

/** A landing page as a page of the site, with its breadcrumb and its questions. */
export function landingGraph(p: Landing, extra: object[] = []) {
  const url = `${SITE_URL}${p.path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: p.title,
        description: p.description,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: p.name, item: url },
        ],
      },
      faqPage(p.faq, url),
      ...extra,
    ],
  };
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const jsonLd = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c");
