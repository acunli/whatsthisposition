import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { Extension } from "@/components/home/Extension";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { SITE_NAME } from "@/lib/brand";
import { LANDING } from "@/lib/landing";
import { EXTENSION_APP, landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.extension;

export const metadata: Metadata = landingMetadata(page);

export default function ChessComExtension() {
  return (
    <div className="shell">
      <JsonLd data={landingGraph(page, [EXTENSION_APP])} />
      <PageTopbar back="Review a game" />
      <main>
        <Extension page />
        <Guide
          title="What it does"
          rows={[
            {
              title: "In the card",
              body: (
                <ul>
                  <li>Accuracy for both players</li>
                  <li>How many Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss and Blunder moves each player made</li>
                  <li>The opening, by name and ECO code</li>
                  <li>Three depths: Fast, Standard and Thorough</li>
                </ul>
              ),
            },
            {
              title: "Every move explained, one click away",
              body: (
                <p>
                  See every move explained opens the <Link href={LANDING.chesscom.path}>full review</Link> on this site with the work already done: nothing is searched
                  twice. There every move is explained, you can try your own moves, and any position opens for a deeper analysis.
                </p>
              ),
            },
            {
              title: "Private",
              body: (
                <p>
                  Stockfish 19 runs on your computer and the extension collects nothing. It works only on chess.com, and only when you click its button. The link to the
                  full review carries the game after the # in the address, a part browsers never send to a server.{" "}
                  <Link href="/credits#privacy">Privacy in full</Link>.
                </p>
              ),
            },
            {
              title: "Install it",
              body: (
                <ol>
                  <li>Click Add to Chrome, then Add extension.</li>
                  <li>Pin it: click the puzzle-piece icon in the toolbar, then the pin next to {SITE_NAME}.</li>
                  <li>Finish a game on Chess.com, click the button and choose Review this game, then Analyze this game in the card.</li>
                </ol>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About the extension." />
      </main>
      <SiteFooter />
    </div>
  );
}
