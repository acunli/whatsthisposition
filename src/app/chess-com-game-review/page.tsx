import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Studio } from "@/components/Studio";
import { Faq } from "@/components/home/Faq";
import { Guide } from "@/components/landing/Guide";
import { LANDING } from "@/lib/landing";
import { landingGraph, landingMetadata } from "@/lib/seo";

const page = LANDING.chesscom;

export const metadata: Metadata = landingMetadata(page);

export default function ChessComGameReview() {
  return (
    <>
      <JsonLd data={landingGraph(page)} />
      <Studio variant={{ title: page.h1, lede: page.lede, tool: "chesscom" }}>
        <Guide
          title="Reviewing a Chess.com game"
          lede="Your username is enough: no account, no upload and no daily limit."
          rows={[
            {
              title: "Find your game",
              body: (
                <>
                  <ol>
                    <li>
                      <b>Type your Chess.com username</b> in the box above and press Find games. Your games from the last three months appear, newest first.
                    </li>
                    <li>
                      <b>Pick a game.</b> The board turns to your side and Stockfish starts on every position. A 40-move game takes about a minute on a computer.
                    </li>
                    <li>
                      <b>Step through it</b> with the arrow keys, the evaluation graph or the key moments. Each label appears as soon as its move is checked.
                    </li>
                  </ol>
                  <p>For an older game, open it on Chess.com, choose Share, then PGN, and paste it in the PGN tab.</p>
                </>
              ),
            },
            {
              title: "What the review shows",
              body: (
                <ul>
                  <li>
                    <b>Accuracy</b> for both players, on Chess.com&apos;s scale.
                  </li>
                  <li>
                    <b>A label for every move</b>, with the names Chess.com uses: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder and
                    Forced. <Link href={LANDING.labels.path}>How each label is decided</Link>.
                  </li>
                  <li>
                    <b>An explanation for every move</b>: what a mistake allows and what was better, what a good move threatens, why a sacrifice works.
                  </li>
                  <li>
                    <b>The opening</b> by name, how long you followed theory, and what strong players play where you left it.
                  </li>
                  <li>
                    <b>Your own moves</b>: play a different move on the board and the new line is analysed and labelled too. Any position opens for a deeper analysis.
                  </li>
                </ul>
              ),
            },
            {
              title: "Why there's no limit",
              body: (
                <p>
                  Stockfish 19 runs inside your browser, on your own computer or phone, so a review costs nothing to serve. That&apos;s why there&apos;s no account, no
                  daily limit and nothing to unlock. The code is open source, and <Link href="/credits#privacy">nothing about your games is kept</Link> unless you share one.
                </p>
              ),
            },
            {
              title: "Without leaving Chess.com",
              body: (
                <p>
                  The free Chrome extension adds a button to Chess.com. After a game it shows both players&apos; accuracy and how many moves of each label they made,
                  next to the board, and opens the full review here in one click. <Link href={LANDING.extension.path}>About the extension</Link>.
                </p>
              ),
            },
            {
              title: "Next to Chess.com's Game Review",
              body: (
                <p>
                  The labels follow Chess.com&apos;s published bands for how much of your winning chances a move gives away, and Brilliant needs a real sacrifice, checked
                  on the board. The engines and search depths differ, so the odd move can get a different label. This site is independent and isn&apos;t affiliated with
                  Chess.com.
                </p>
              ),
            },
          ]}
        />
        <Faq items={page.faq} lede="About reviewing your Chess.com games here." />
      </Studio>
    </>
  );
}
