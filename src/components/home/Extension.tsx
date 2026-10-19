import Image from "next/image";
import Link from "next/link";
import { LANDING } from "@/lib/landing";
import { AddToChrome } from "../AddToChrome";

/**
 * The Chess.com extension: what it does, and the button to add it. On the extension's own page
 * it is the page's heading (`page`), and doesn't link to itself.
 */
export function Extension({ page = false }: { page?: boolean }) {
  const Heading = page ? "h1" : "h2";
  return (
    <section className="section ext" aria-labelledby="ext-title">
      <div className="ext-grid">
        <div className="ext-copy">
          <Heading className="h-section" id="ext-title">
            {page ? LANDING.extension.h1 : "Review it without leaving Chess.com"}
          </Heading>
          <p className="section-lede">{LANDING.extension.lede}</p>
          <ol className="ext-steps">
            <li>
              <span>
                <b>Finish a game</b> on Chess.com, or open one of yours.
              </span>
            </li>
            <li>
              <span>
                <b>Click the extension&apos;s button</b> and press Analyze. Stockfish reviews the game on your computer.
              </span>
            </li>
            <li>
              <span>
                <b>See every move explained</b> opens it here, step by step.
              </span>
            </li>
          </ol>
          <div className="ext-actions">
            <AddToChrome from="section" className="btn btn-primary btn-xl">
              Add to Chrome, it&apos;s free
            </AddToChrome>
            <p className="ext-note">
              For Chrome, Edge, Brave and other Chromium browsers on a computer. It only reviews finished games, and collects nothing.
              {!page && (
                <>
                  {" "}
                  <Link href={LANDING.extension.path}>More about the extension</Link>
                </>
              )}
            </p>
          </div>
        </div>
        <figure className="ext-shot">
          <Image
            src="/extension-card.jpg"
            width={360}
            height={689}
            sizes="(max-width: 760px) 300px, 360px"
            alt="The extension's card on Chess.com after a game: both players' accuracy, the opening, and how many moves of each kind each player made"
          />
        </figure>
      </div>
    </section>
  );
}
