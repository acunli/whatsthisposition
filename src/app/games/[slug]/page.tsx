import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { Guide } from "@/components/landing/Guide";
import { GameLink } from "@/components/games/GameLink";
import { ClassIcon } from "@/components/review/ClassIcon";
import { SITE_NAME, SITE_URL } from "@/lib/brand";
import type { Color } from "@/lib/chess/types";
import type { GameRecord } from "@/lib/content/games";
import { eventLine, gameDescription, gameLede, gameTitle } from "@/lib/content/text";
import { CLASS_INFO, type MoveClass } from "@/lib/review/classify";
import { parseGame } from "@/lib/review/pgn";
import { allGames, gameBySlug } from "@/lib/server/content";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return allGames().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = gameBySlug((await params).slug);
  if (!g) return {};
  const title = gameTitle(g);
  const description = gameDescription(g);
  const path = `/games/${g.slug}`;
  return {
    title: { absolute: `${title} · ${SITE_NAME}` },
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, siteName: SITE_NAME, title, description, locale: "en_US", publishedTime: g.published },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** The labels a page counts per player, best to worst. */
const COUNTED: MoveClass[] = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];

function Score({ g }: { g: GameRecord }) {
  const s = g.summary;
  const colors = parseGame(g.pgn).moves.map((m) => m.color);
  const count = (c: Color, cls: MoveClass) => g.labels.filter((l, i) => l === cls && colors[i] === c).length;
  const counts = COUNTED.map((cls) => ({ cls, w: count("w", cls), b: count("b", cls) })).filter((r) => r.w || r.b);
  const elo = (c: Color) => (c === "w" ? s.whiteElo : s.blackElo);
  return (
    <div className="game-score">
      {(["w", "b"] as Color[]).map((c) => (
        <div key={c} className="game-player">
          <span className={`game-swatch game-swatch-${c}`} aria-hidden />
          <span className="game-name">
            {c === "w" ? g.white : g.black}
            {elo(c) && <span className="muted"> {elo(c)}</span>}
          </span>
          <b className="game-acc mono" title="Accuracy, on Chess.com's scale">
            {s.accuracy[c] != null ? s.accuracy[c]!.toFixed(1) : "–"}
          </b>
        </div>
      ))}
      <table className="game-counts">
        <thead>
          <tr>
            <th scope="col">{g.white}</th>
            <th scope="col">
              <span className="sr-only">Label</span>
            </th>
            <th scope="col">{g.black}</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((r) => (
            <tr key={r.cls}>
              <td className="mono">{r.w}</td>
              <th scope="row">
                <ClassIcon cls={r.cls} size={16} />
                {CLASS_INFO[r.cls].label}
              </th>
              <td className="mono">{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Moves({ g }: { g: GameRecord }) {
  const game = parseGame(g.pgn);
  const rows: { num: number; w?: number; b?: number }[] = [];
  game.moves.forEach((m, i) => {
    if (m.color === "w" || !rows.length) rows.push({ num: m.moveNumber });
    rows[rows.length - 1][m.color] = i;
  });
  const cell = (i?: number) => {
    if (i === undefined) return <span />;
    const cls = g.labels[i];
    return (
      <span className="game-move" title={CLASS_INFO[cls].label}>
        <ClassIcon cls={cls} size={14} />
        {game.moves[i].san}
      </span>
    );
  };
  return (
    <ol className="game-moves">
      {rows.map((r) => (
        <li key={r.num}>
          <span className="muted mono">{r.num}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </li>
      ))}
    </ol>
  );
}

export default async function GamePage({ params }: Props) {
  const g = gameBySlug((await params).slug);
  if (!g) notFound();
  const url = `${SITE_URL}/games/${g.slug}`;
  const others = allGames()
    .filter((o) => o.slug !== g.slug)
    .slice(0, 6);
  const fromLichess = g.source.kind === "broadcast";
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: gameTitle(g),
        description: gameDescription(g),
        datePublished: g.published,
        image: `${url}/opengraph-image`,
        inLanguage: "en",
        author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        mainEntityOfPage: url,
        about: [g.white, g.black].map((name) => ({ "@type": "Person", name })),
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Reviewed games", item: `${SITE_URL}/games` },
          { "@type": "ListItem", position: 3, name: `${g.white} vs ${g.black}`, item: url },
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
                <Link href="/games">Reviewed games</Link> / {eventLine(g)}
              </p>
              <h1 className="h-section">
                {g.white} vs {g.black}: game review
              </h1>
            </div>
            <p className="section-lede">{gameLede(g)}</p>
          </div>
          <div className="game-top">
            {/* eslint-disable-next-line @next/next/no-img-element -- the page's own preview card, already sized */}
            <img className="game-card" src={`/games/${g.slug}/opengraph-image`} width={1200} height={630} alt={`The board ${g.summary.moment ? `after ${g.summary.moment.name}` : "at the end"}, with both players' accuracy`} />
            <div className="game-side">
              <Score g={g} />
              <div className="game-actions">
                <Link className="btn btn-primary" href={`/games/${g.slug}/review`}>
                  Step through every move
                </Link>
                <Link className="btn" href="/">
                  Review your own game
                </Link>
              </div>
            </div>
          </div>
        </section>

        {g.moments.length > 0 && (
          <Guide
            title="Key moments"
            lede="The Brilliant and Great moves, and the costliest mistakes, as the review explains them."
            rows={g.moments.map((m) => ({
              title: `${m.name}: ${CLASS_INFO[m.cls].label}`,
              body: (
                <>
                  <p>
                    <b>{m.headline}</b>
                  </p>
                  {m.points.length > 0 && (
                    <ul>
                      {m.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {m.why && (
                    <ul>
                      {m.why.map((w) => (
                        <li key={w.title}>
                          <b>{w.title}:</b> {w.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.better && (
                    <p>
                      <b>Better:</b> {m.better}
                    </p>
                  )}
                </>
              ),
            }))}
          />
        )}

        {g.opening && g.opening.points.length > 0 && (
          <Guide
            title="The opening"
            rows={[
              {
                title: g.opening.name ? `${g.opening.name}${g.opening.eco ? ` (${g.opening.eco})` : ""}` : "Opening theory",
                body: (
                  <ul>
                    {g.opening.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        )}

        <section className="section">
          <div className="section-head">
            <h2 className="h-section">Every move</h2>
            <p className="section-lede">
              The moves from {fromLichess ? "the official broadcast on Lichess" : "Chess.com"} (
              <a href={g.source.url} rel="nofollow noopener" target="_blank">
                the game
              </a>
              ), each with its label. Step through them on the board for the engine lines and an explanation of every move.
            </p>
          </div>
          <Moves g={g} />
        </section>

        {others.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="h-section">More reviewed games</h2>
              <p className="section-lede">
                <Link href="/games">Every reviewed game</Link>, newest first.
              </p>
            </div>
            <ul className="games-list">
              {others.map((o) => (
                <GameLink key={o.slug} g={o} />
              ))}
            </ul>
          </section>
        )}

        <section className="closing">
          <h2 className="h-section">See your own games like this.</h2>
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
