import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Studio } from "@/components/Studio";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.pgn;

export const metadata: Metadata = landingMetadata(page);

export default function PgnAnalyzer() {
  return (
    <>
      <JsonLd data={landingGraph(page)} />
      <Studio variant={{ title: page.h1, lede: page.lede, tool: "pgn" }}>
        <Guide
          title="What it reads"
          lede="Real exports from real apps, not only tidy files."
          rows={[
            {
              title: "Any PGN",
              body: (
                <p>
                  Exports from Chess.com, Lichess, ChessBase and other apps, with their headers, comments, clock times, variations and annotation symbols. A bare move
                  list (1. e4 e5 2. Nf3 Nc6 …) works too. Every move is checked against the rules before the review starts.
                </p>
              ),
            },
            {
              title: "Files with several games",
              body: <p>Drop or paste a file with many games, such as a tournament&apos;s, and pick the one to review. Files can be up to 5 MB.</p>,
            },
            {
              title: "Where to find a game's PGN",
              body: (
                <ul>
                  <li>
                    <b>Chess.com</b>: open the game, then Share, then PGN. Or skip the PGN and <Link href={LANDING.chesscom.path}>enter your username</Link>.
                  </li>
                  <li>
                    <b>Lichess</b>: Share &amp; export, then PGN. A <Link href={LANDING.lichess.path}>game link</Link> works too.
                  </li>
                  <li>
                    <b>ChessBase and other apps</b>: export or save the game as PGN.
                  </li>
                  <li>
                    <b>An over-the-board game</b>: type the moves from your scoresheet as a list.
                  </li>
                </ul>
              ),
            },
            {
              title: "What you get",
              body: (
                <p>
                  Both players&apos; accuracy, a label for every move from Brilliant to Blunder with an explanation, the evaluation graph and key moments, and the opening
                  with how long the game followed theory. You can play your own moves on the board and open any position for a deeper analysis.{" "}
                  <Link href={LANDING.labels.path}>How each label is decided</Link>.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About reviewing a game from its PGN." />
      </Studio>
    </>
  );
}
