import Image from "next/image";
import { AddToChrome } from "../AddToChrome";

/** The Chess.com extension: what it does, and the button to add it. */
export function Extension() {
  return (
    <section className="section ext" aria-labelledby="ext-title">
      <div className="ext-grid">
        <div className="ext-copy">
          <h2 className="h-section" id="ext-title">
            Review it without leaving Chess.com
          </h2>
          <p className="section-lede">
            The free extension reviews a finished Chess.com game right where you played it: both players&apos; accuracy and every move counted, from Brilliant to
            Blunder. One more click opens the whole review here, already done.
          </p>
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
