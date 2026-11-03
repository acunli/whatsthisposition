import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { SITE_NAME, SITE_URL } from "@/lib/brand";
import { MIN_GAMES } from "@/lib/openings/catalog";
import { openingCatalog } from "@/lib/server/openings";

const TITLE = "Chess openings: moves and how strong players score";
const DESCRIPTION =
  "Every chess opening that strong players reach often: its moves, how it scores for White and Black, what is played next and where each move leads, from 1.8 million master and elite games.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: "/openings" },
  openGraph: { type: "website", url: "/openings", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

/** How many of a family's openings the index lists (its own page lists them all). */
const PER_FAMILY = 8;

/** Every opening family, most played first, with its most played lines. */
export default function Openings() {
  const cat = openingCatalog();
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/openings`,
    url: `${SITE_URL}/openings`,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };
  return (
    <div className="shell">
      <JsonLd data={structured} />
      <PageTopbar back="Review your own game" />
      <main>
        <section className="section">
          <div className="section-head">
            <h1 className="h-section">Chess openings</h1>
            <p className="section-lede">
              {cat.all.length.toLocaleString("en-US")} named openings in {cat.families.length} families, each reached in at least {MIN_GAMES} games between strong players
              (over-the-board broadcasts and the Lichess Elite Database). Each page has the moves, how the opening scores, what is played next and where it leads. Names
              from the Lichess opening catalogue.
            </p>
          </div>
          <div className="op-families">
            {cat.families.map((f) => {
              const root = f.openings.find((o) => o.name === f.name);
              const lines = (root ? f.openings.filter((o) => o !== root) : f.openings).slice(0, PER_FAMILY);
              const rest = f.openings.length - lines.length - (root ? 1 : 0);
              return (
                <section key={f.name} className="op-family" aria-label={f.name}>
                  <h2>{root ? <Link href={`/openings/${root.slug}`}>{f.name}</Link> : f.name}</h2>
                  <ul>
                    {lines.map((o) => (
                      <li key={o.slug}>
                        <Link href={`/openings/${o.slug}`}>{o.name.slice(f.name.length).replace(/^:\s*/, "") || o.name}</Link>
                      </li>
                    ))}
                  </ul>
                  {rest > 0 && root && (
                    <Link className="small" href={`/openings/${root.slug}`}>
                      All {f.openings.length} lines
                    </Link>
                  )}
                </section>
              );
            })}
          </div>
        </section>
        <section className="closing">
          <h2 className="h-section">See where your own games left theory.</h2>
          <p className="section-lede">Enter a Chess.com or Lichess username: the review names your opening, shows the move you left the book and labels every move after it.</p>
          <div className="closing-actions">
            <Link className="btn btn-primary btn-xl" href="/">
              Review a game
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
