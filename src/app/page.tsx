import { Studio } from "@/components/Studio";
import { EXTENSION_URL, SITE_ASCII, SITE_DESCRIPTION, SITE_NAME, SITE_URL, SOURCE_URL } from "@/lib/brand";
import { FAQ } from "@/lib/faq";

/** What the site is, for search engines: the site, the app, and the questions answered on this page. */
const STRUCTURED = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: [SITE_ASCII, "whats this position", "what's this position"],
      description: SITE_DESCRIPTION,
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "GameApplication",
      applicationSubCategory: "Chess analysis",
      operatingSystem: "Any (runs in the browser)",
      browserRequirements: "Requires JavaScript and WebAssembly",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Game review of Chess.com and Lichess games by username, link or PGN",
        "Every move labelled from Brilliant to Blunder, with an explanation",
        "Accuracy scores on Chess.com's scale",
        "Opening names and theory from 1.8 million games between strong players",
        "Position analysis from a FEN, a board set up by hand, or a screenshot",
        "Stockfish 19 running in the browser",
      ],
      screenshot: `${SITE_URL}/og.png`,
      author: { "@type": "Person", name: "Ayushman Chaudhuri", url: "https://ayushman.rocks" },
      sameAs: [SOURCE_URL, EXTENSION_URL],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED).replace(/</g, "\\u003c") }} />
      <Studio />
    </>
  );
}
