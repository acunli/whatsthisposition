import type { Metadata } from "next";
import Link from "@/components/Link";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { AccuracyTool } from "@/components/accuracy/AccuracyTool";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { ACCURACY_CLASSES, ACCURACY_DATA, CLASS_NAME, at, bandLabel, bandsOf, medianOf } from "@/lib/accuracy/byRating";
import { SITE_NAME, SITE_URL } from "@/lib/brand";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.accuracy;

export const metadata: Metadata = landingMetadata(page);

const one = (x: number | null) => (x === null ? "–" : x.toFixed(1));
const fmt = (n: number) => n.toLocaleString("en-US");

/** The numbers behind the page, for dataset search. */
const DATASET = {
  "@type": "Dataset",
  "@id": `${SITE_URL}${page.path}#data`,
  name: "Chess.com accuracy by rating",
  description: `Percentiles of Chess.com's game accuracy by player rating, in rapid, blitz and bullet, with the median accuracy in won and lost games, from ${fmt(ACCURACY_DATA.games)} rated games Chess.com reviewed (read from its public API).`,
  url: `${SITE_URL}${page.path}`,
  creator: { "@type": "Person", name: "Ayushman Chaudhuri", url: "https://ayushman.rocks" },
  isAccessibleForFree: true,
  dateModified: ACCURACY_DATA.updated,
  variableMeasured: ["Game accuracy", "Player rating", "Time control", "Result"],
  measurementTechnique: "Chess.com's own accuracy for each player of each game, grouped by the player's rating at the time in bands of 200 points",
};

/** Accuracy by rating: what is a good accuracy for a rating, from Chess.com's own numbers. */
export default function ChessAccuracy() {
  return (
    <div className="shell">
      <JsonLd data={landingGraph(page, [DATASET])} />
      <PageTopbar back="Review a game" />
      <main>
        <section className="section">
          <div className="section-head">
            <h1 className="h-section">{page.h1}</h1>
            <p className="section-lede">{page.lede}</p>
          </div>
          <AccuracyTool />
        </section>
        <section className="section" aria-labelledby="acc-tables">
          <div className="section-head">
            <h2 className="h-section" id="acc-tables">
              The numbers
            </h2>
            <p className="section-lede">
              Each player of each game counts once, at their rating when the game was played. The median is the middle game: half of the games are more accurate, half
              less.
            </p>
          </div>
          <div className="acc-tables">
            {ACCURACY_CLASSES.map((tc) => (
              <div key={tc} className="acc-table-wrap">
                <table className="acc-table">
                  <caption>{CLASS_NAME[tc]}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rating</th>
                      <th scope="col">Median</th>
                      <th scope="col">Middle half</th>
                      <th scope="col">In wins</th>
                      <th scope="col">In losses</th>
                      <th scope="col">Games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bandsOf(tc).map((b) => (
                      <tr key={b.from}>
                        <th scope="row">{bandLabel(b)}</th>
                        <td>{one(medianOf(b))}</td>
                        <td>
                          {one(at(b, 25))}–{one(at(b, 75))}
                        </td>
                        <td>{one(b.won)}</td>
                        <td>{one(b.lost)}</td>
                        <td>{fmt(b.n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
        <Guide
          title="Where the numbers come from"
          rows={[
            {
              title: "Chess.com's own accuracy",
              body: (
                <p>
                  Chess.com shows each player&apos;s accuracy once a game has been reviewed, and its public API gives it with both ratings, the time control and the result.
                  The games come from {fmt(ACCURACY_DATA.games)} rated games of players picked from Chess.com&apos;s country lists, at every level, plus the blitz and bullet
                  games of a dozen of the world&apos;s best online players and their opponents, which give the 2800+ rows. The sampled players&apos; games that ended within ten
                  moves each are left out.
                </p>
              ),
            },
            {
              title: "What it can't tell you",
              body: (
                <p>
                  Accuracy depends on the game as much as on the player: a short game or a quiet one scores higher than a long fight, and a single blunder can cost a game
                  that was otherwise accurate. Read your number against the range for your rating, not as a grade. Rating bands with too few games (fewer than{" "}
                  {ACCURACY_DATA.minGames} player-games) are left out.
                </p>
              ),
            },
            {
              title: "Your own games",
              body: (
                <p>
                  <Link href="/">Review a game</Link> on {SITE_NAME} to get both players&apos; accuracy on Chess.com&apos;s scale, a performance rating for each, and every
                  move labelled from Brilliant to Blunder, with the reasons. <Link href={LANDING.labels.path}>How the labels and accuracy are worked out</Link>.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About accuracy and ratings." />
        <section className="closing">
          <h2 className="h-section">See your own accuracy, move by move.</h2>
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
