import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { Faq } from "@/components/home/Faq";
import { Labels } from "@/components/home/Labels";
import { Guide } from "@/components/landing/Guide";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.labels;

export const metadata: Metadata = landingMetadata(page);

/** The rules of src/lib/review/classify.ts in words. Keep them in step with the code. */
export default function ChessMoveClassifications() {
  return (
    <div className="shell">
      <JsonLd data={landingGraph(page)} />
      <PageTopbar back="Review a game" />
      <main>
        <Labels page />
        <Guide
          title="The rules in detail"
          lede="The same rules for every game, from your blitz games to world championships."
          rows={[
            {
              title: "Winning chances, not pawns",
              body: (
                <p>
                  Stockfish evaluates the position before and after your move, and both evaluations are turned into winning chances (your expected score) with
                  Lichess&apos;s win-probability curve. A move&apos;s label depends on how much of those chances it gives away compared with the engine&apos;s best move,
                  in the bands Chess.com publishes. That&apos;s why dropping a pawn&apos;s worth matters far more in a level position than when you&apos;re a rook up.
                </p>
              ),
            },
            {
              title: "Brilliant",
              body: (
                <>
                  <p>A good sacrifice. All of these must hold:</p>
                  <ul>
                    <li>it&apos;s the engine&apos;s best move;</li>
                    <li>
                      it really gives material away: a piece left where it can be taken, or put there, checked with exchange arithmetic on the board rather than guessed
                      from the score;
                    </li>
                    <li>it beats the best move that gives nothing away;</li>
                    <li>you aren&apos;t worse after it;</li>
                    <li>you weren&apos;t already completely winning without it;</li>
                    <li>it isn&apos;t a way out of check or a promotion to a queen.</li>
                  </ul>
                  <p>
                    &ldquo;Completely winning&rdquo; depends on the players&apos; rating. Below about 2600, players turn an advantage into a win less surely than
                    engines do, so the same evaluation counts as less decided.
                  </p>
                </>
              ),
            },
            {
              title: "Great",
              body: (
                <p>
                  The only good move: the engine&apos;s best, when every other move gives away at least 10% of your winning chances. Like Brilliant, it isn&apos;t given
                  when the game is already decided, when you&apos;re worse after it, or for simply taking a piece that was free.
                </p>
              ),
            },
            {
              title: "Miss",
              body: (
                <p>
                  A chance let go. You had a forced mate, a line that wins at least two points of material more than yours, or a winning position (about +3 for club
                  players, +2.3 at the top), and your move, an error by the bands above, lets it go without giving anything away itself. If it allows mate, loses
                  material or leaves you lost, it stays a Mistake or a Blunder: on Chess.com, too, a Blunder must lose material or allow checkmate.
                </p>
              ),
            },
            {
              title: "Book and Forced",
              body: (
                <p>
                  Book moves are opening theory: positions reached in at least 20 of 1.84 million games between strong players, from over-the-board events and the
                  strongest online games, for as long as the game stays in theory. Forced is the only legal move.
                </p>
              ),
            },
            {
              title: "Accuracy",
              body: (
                <p>
                  Each move&apos;s accuracy comes from the winning chances it gives away, with Lichess&apos;s formula. The game&apos;s accuracy combines them and is put
                  on Chess.com&apos;s scale, fitted on games Chess.com reviewed; it usually lands within 3 to 4 points of Chess.com&apos;s number.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About the labels." />
        <section className="closing">
          <h2 className="h-section">See the labels on your own games.</h2>
          <p className="section-lede">Enter a Chess.com or Lichess username or paste a PGN, then step through the game move by move.</p>
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
