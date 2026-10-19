import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Studio } from "@/components/Studio";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.position;

export const metadata: Metadata = landingMetadata(page);

export default function ChessPositionAnalyzer() {
  return (
    <>
      <JsonLd data={landingGraph(page)} />
      <Studio variant={{ title: page.h1, lede: page.lede, tool: "position" }}>
        <Guide
          title="What it shows"
          lede="The evaluation, and the reasons behind it."
          rows={[
            {
              title: "Three ways in",
              body: (
                <>
                  <ul>
                    <li>
                      <b>A screenshot or photo</b> of a board is read on your device by a small neural network. Check the board, then set whose move it is.
                    </li>
                    <li>
                      <b>A FEN</b>: paste it and the analysis starts.
                    </li>
                    <li>
                      <b>Set up a board</b>: place the pieces by hand.
                    </li>
                  </ul>
                  <p>Screenshots of an online board read best. A photo of a real board taken at an angle may need a few squares fixed by hand.</p>
                </>
              ),
            },
            {
              title: "Reasons, not only a number",
              body: (
                <p>
                  Stockfish&apos;s top lines come with what the position is about: the threats right now, weaknesses such as holes and loose pawns, strengths such as a
                  dominant piece or a passed pawn, and plans for both sides, with when to play them and what can go wrong. Each item is drawn on the board and marked as
                  a board fact, an engine result or an idea.
                </p>
              ),
            },
            {
              title: "Ask about a move",
              body: <p>Pick a candidate move to see why the engine likes it, or why another move doesn&apos;t work: the line is played out on the board and explained.</p>,
            },
            {
              title: "From a game review",
              body: (
                <p>
                  Any position of a <Link href={LANDING.chesscom.path}>reviewed game</Link> opens here in one click, and the review is kept for when you go back to it.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About analysing a single position." />
      </Studio>
    </>
  );
}
