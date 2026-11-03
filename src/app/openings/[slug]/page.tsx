import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { GameLink } from "@/components/games/GameLink";
import { StaticBoard } from "@/components/openings/StaticBoard";
import { SITE_NAME, SITE_URL } from "@/lib/brand";
import { numbered, openingSummary, pct, type Opening, type Score } from "@/lib/openings/catalog";
import { allGames } from "@/lib/server/content";
import { openingCatalog } from "@/lib/server/openings";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return openingCatalog().all.map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const o = openingCatalog().bySlug.get((await params).slug);
  if (!o) return {};
  const title = `${o.name} (${o.eco}): moves and statistics`;
  const description = openingSummary(o);
  const path = `/openings/${o.slug}`;
  return {
    title: { absolute: `${title} · ${SITE_NAME}` },
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, siteName: SITE_NAME, title, description, locale: "en_US", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

/** White's wins, draws and Black's wins as one bar, with the numbers. */
function Results({ s, label }: { s: Score; label: string }) {
  return (
    <span className="op-bar" role="img" aria-label={`${label}: White wins ${pct(s.white)}, draws ${pct(s.draw)}, Black wins ${pct(s.black)}`}>
      <span className="op-bar-w" style={{ width: `${s.white}%` }}>
        {s.white >= 14 ? pct(s.white) : ""}
      </span>
      <span className="op-bar-d" style={{ width: `${s.draw}%` }}>
        {s.draw >= 14 ? pct(s.draw) : ""}
      </span>
      <span className="op-bar-b" style={{ width: `${s.black}%` }}>
        {s.black >= 14 ? pct(s.black) : ""}
      </span>
    </span>
  );
}

function OpeningList({ items }: { items: Opening[] }) {
  return (
    <ul className="op-list">
      {items.map((o) => (
        <li key={o.slug}>
          <Link href={`/openings/${o.slug}`}>{o.name}</Link>
          <span className="small muted mono"> {o.games.toLocaleString("en-US")} games</span>
        </li>
      ))}
    </ul>
  );
}

export default async function OpeningPage({ params }: Props) {
  const cat = openingCatalog();
  const o = cat.bySlug.get((await params).slug);
  if (!o) notFound();
  const url = `${SITE_URL}/openings/${o.slug}`;
  const parent = o.parent ? cat.bySlug.get(o.parent) : undefined;
  const children = o.children.map((s) => cat.bySlug.get(s)!);
  const family = cat.families.find((f) => f.name === o.family)!;
  // The family's own page lists every opening in it; the others list a few more of the family.
  const isRoot = o.name === o.family;
  const shown = new Set([o.slug, o.parent, ...o.children]);
  const more = isRoot ? family.openings.filter((x) => x.slug !== o.slug) : family.openings.filter((x) => !shown.has(x.slug)).slice(0, 12);
  const familyRoot = cat.all.find((x) => x.name === o.family);
  const games = allGames().filter((g) => g.opening?.name === o.name || (isRoot && g.opening?.name?.startsWith(`${o.family}:`)));
  const moveNo = (ply: number) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? "." : "…"}`;
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: o.name,
        description: openingSummary(o),
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@type": "Thing", name: o.name, alternateName: o.eco },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Chess openings", item: `${SITE_URL}/openings` },
          ...(familyRoot && familyRoot.slug !== o.slug ? [{ "@type": "ListItem", position: 3, name: familyRoot.name, item: `${SITE_URL}/openings/${familyRoot.slug}` }] : []),
          { "@type": "ListItem", position: familyRoot && familyRoot.slug !== o.slug ? 4 : 3, name: o.name, item: url },
        ],
      },
    ],
  };

  return (
    <div className="shell">
      <JsonLd data={structured} />
      <PageTopbar back="Review your own game" />
      <main>
        <section className="section">
          <div className="section-head">
            <div>
              <p className="eyebrow">
                <Link href="/openings">Chess openings</Link>
                {familyRoot && familyRoot.slug !== o.slug && (
                  <>
                    {" / "}
                    <Link href={`/openings/${familyRoot.slug}`}>{familyRoot.name}</Link>
                  </>
                )}
              </p>
              <h1 className="h-section">{o.name}</h1>
            </div>
            <p className="section-lede">{openingSummary(o)}</p>
          </div>
          <div className="op-top">
            <StaticBoard fen={o.fen} label={`The position after ${numbered(o.sans)}`} />
            <div className="game-side">
              <div className="game-score">
                <p className="op-line mono">{numbered(o.sans)}</p>
                <dl className="op-facts">
                  <div>
                    <dt>ECO</dt>
                    <dd className="mono">{o.eco}</dd>
                  </div>
                  <div>
                    <dt>Games between strong players</dt>
                    <dd className="mono">{o.games.toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt>To move</dt>
                    <dd>{o.sans.length % 2 === 0 ? "White" : "Black"}</dd>
                  </div>
                </dl>
                <Results s={o.score} label="Results from here" />
                <p className="small muted">White wins, draws and Black wins, from this position.</p>
              </div>
              <div className="game-actions">
                <Link className="btn btn-primary" href={`/chess-position-analyzer?fen=${encodeURIComponent(o.fen)}`}>
                  Analyse this position
                </Link>
                <Link className="btn" href="/">
                  Review your own game
                </Link>
              </div>
            </div>
          </div>
        </section>

        {o.next.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="h-section">What strong players play next</h2>
              <p className="section-lede">
                The moves played most from this position in over-the-board broadcasts and the Lichess Elite Database, how often, and how the games ended.
              </p>
            </div>
            <table className="op-next">
              <thead>
                <tr>
                  <th scope="col">Move</th>
                  <th scope="col">Played</th>
                  <th scope="col">Results</th>
                  <th scope="col" className="op-next-to">
                    Leads to
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.next.map((m) => (
                  <tr key={m.san}>
                    <th scope="row" className="mono">
                      {moveNo(o.sans.length)}
                      {m.san}
                    </th>
                    <td className="mono">
                      {pct(m.share)} <span className="muted">({m.games.toLocaleString("en-US")})</span>
                    </td>
                    <td>
                      <Results s={m} label={`After ${m.san}`} />
                    </td>
                    <td className="op-next-to">{m.to ? <Link href={`/openings/${m.to}`}>{cat.bySlug.get(m.to)!.name}</Link> : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {(parent || children.length > 0) && (
          <section className="section">
            <div className="section-head">
              <h2 className="h-section">Where it comes from and where it goes</h2>
            </div>
            {parent && (
              <p className="op-parent">
                Branches from <Link href={`/openings/${parent.slug}`}>{parent.name}</Link> <span className="small muted mono">{numbered(parent.sans)}</span>
              </p>
            )}
            {children.length > 0 && <OpeningList items={children} />}
          </section>
        )}

        {games.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="h-section">Top players&apos; games in the {isRoot ? o.family : o.name}, reviewed</h2>
            </div>
            <ul className="games-list">
              {games.slice(0, 9).map((g) => (
                <GameLink key={g.slug} g={g} />
              ))}
            </ul>
          </section>
        )}

        {more.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="h-section">{isRoot ? `Every ${o.family} line` : `More ${o.family} lines`}</h2>
            </div>
            <OpeningList items={more} />
          </section>
        )}

        <section className="closing">
          <h2 className="h-section">Played the {o.family} lately?</h2>
          <p className="section-lede">Enter your Chess.com or Lichess username: every move of your game labelled from Brilliant to Blunder, and where you left theory. Free, no account.</p>
          <div className="closing-actions">
            <Link className="btn btn-primary btn-xl" href="/">
              Review your game
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
