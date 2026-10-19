import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { GameLink } from "@/components/games/GameLink";
import { SITE_NAME, SITE_URL } from "@/lib/brand";
import { gameTitle } from "@/lib/content/text";
import { allGames } from "@/lib/server/content";

const TITLE = "Top players' games, reviewed move by move";
const DESCRIPTION =
  "Recent games from top over-the-board events and Chess.com's highest-rated players, reviewed by Stockfish 19: both accuracies, every Brilliant move explained, every mistake shown.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: "/games" },
  openGraph: { type: "website", url: "/games", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

/** Every reviewed game (src/lib/content), newest first. */
export default function Games() {
  const games = allGames();
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/games`,
    url: `${SITE_URL}/games`,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: games.slice(0, 100).map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}/games/${g.slug}`, name: gameTitle(g) })),
    },
  };
  return (
    <div className="shell">
      <JsonLd data={structured} />
      <PageTopbar back="Review your own game" />
      <main>
        <section className="section">
          <div className="section-head">
            <h1 className="h-section">{TITLE}</h1>
            <p className="section-lede">
              Each day, the strongest finished games from top events broadcast on Lichess and from Chess.com&apos;s leaderboards are reviewed with the same engine
              and the same labels as <Link href="/">your own games</Link>. New games are added every day.
            </p>
          </div>
          {games.length ? (
            <ul className="games-list">
              {games.map((g) => (
                <GameLink key={g.slug} g={g} />
              ))}
            </ul>
          ) : (
            <p className="section-lede">The first games are on their way.</p>
          )}
        </section>
        <section className="closing">
          <h2 className="h-section">Now see your own games like this.</h2>
          <p className="section-lede">Enter a Chess.com or Lichess username or paste a PGN: free, no account, no daily limit.</p>
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
