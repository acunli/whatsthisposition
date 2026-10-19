import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Studio } from "@/components/Studio";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.lichess;

export const metadata: Metadata = landingMetadata(page);

export default function LichessGameReview() {
  return (
    <>
      <JsonLd data={landingGraph(page)} />
      <Studio variant={{ title: page.h1, lede: page.lede, tool: "lichess" }}>
        <Guide
          title="Reviewing a Lichess game"
          lede="A username or a game link is enough: no account and no API token."
          rows={[
            {
              title: "Three ways in",
              body: (
                <ul>
                  <li>
                    <b>Your username</b>: your 20 most recent games appear. Pick one and the board turns to your side.
                  </li>
                  <li>
                    <b>A game link</b> such as lichess.org/abcd1234 opens that game straight away.
                  </li>
                  <li>
                    <b>A PGN</b>: on Lichess, open Share &amp; export, copy the PGN and paste it in the PGN tab.
                  </li>
                </ul>
              ),
            },
            {
              title: "More than inaccuracies and blunders",
              body: (
                <p>
                  Lichess&apos;s computer analysis marks inaccuracies, mistakes and blunders. Here every move gets a label, including Brilliant for a real sacrifice,
                  Great for the only good move, Book for opening theory and Miss for a chance you let go, and an explanation in plain words: what a mistake allows, what
                  was better and why. <Link href={LANDING.labels.path}>How each label is decided</Link>.
                </p>
              ),
            },
            {
              title: "Accuracy on Chess.com's scale",
              body: (
                <p>
                  Each move&apos;s accuracy uses Lichess&apos;s own formula, and the game&apos;s score is fitted to Chess.com&apos;s reviews of real games. So a Lichess
                  game can be compared with a Chess.com one, or with a friend who plays there.
                </p>
              ),
            },
            {
              title: "In your browser",
              body: (
                <p>
                  Stockfish 19 runs on your device. The game is fetched from Lichess&apos;s public API and isn&apos;t stored, and the review never leaves your browser.
                  Have a single position instead? Use the <Link href={LANDING.position.path}>position analyzer</Link>.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About reviewing your Lichess games here." />
      </Studio>
    </>
  );
}
