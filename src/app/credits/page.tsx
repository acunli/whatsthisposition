import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "How it works & credits · WhatsThisPosition" };

export default function Credits() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="logo" aria-label="WhatsThisPosition home">
          <Logo size={32} />
        </Link>
        <nav className="topbar-nav">
          <Link className="navlink" href="/">
            ← Back to the board
          </Link>
        </nav>
      </header>
      <main className="prose">
        <div className="eyebrow">Notes</div>
        <h1>How it works</h1>
        <p>
          Every highlight on the board has a source, and every item is labelled with it. <b>Board facts</b> follow from the
          position and the rules alone: attacks, pins, pawn structure, holes, space and so on. <b>Engine</b> items come from
          Stockfish&apos;s search. <b>Ideas</b> are plans worth testing that the engine hasn&apos;t confirmed. We never split the evaluation
          into made-up percentages.
        </p>
        <p>
          Explanations are written from templates over those facts. No language model writes or changes them. The concepts and how
          each is drawn are documented in <code>docs/position-understanding.md</code>.
        </p>

        <h2>Privacy</h2>
        <p>
          Analysis runs entirely in your browser. If you upload a photo, it goes to this site&apos;s server and on to Anthropic&apos;s API
          to read the pieces. It&apos;s held in memory for that request only, and WhatsThisPosition doesn&apos;t store it. FEN and hand
          setup never leave your device.
        </p>

        <h2>Stockfish</h2>
        <p>
          The engine is <a href="https://github.com/nmrugg/stockfish.js">Stockfish.js</a> (Stockfish 19, lite single-threaded
          WebAssembly build) by Nathan Rugg and Chess.com, based on <a href="https://stockfishchess.org">Stockfish</a> by the
          Stockfish developers. It&apos;s free software under the GNU General Public License v3, served from this site with its licence at{" "}
          <a href="/engine/COPYING.txt">/engine/COPYING.txt</a>. Engine source is available from the Stockfish.js repository.
          This website&apos;s own source is offered under the GPL v3 or later.
        </p>

        <h2>Pieces, type and libraries</h2>
        <p>
          Piece set: “mpchess” by Maxime Chupin (GPL-3.0+), as distributed with <a href="https://github.com/lichess-org/lila">Lichess</a>.
          Type: Big Shoulders, Hanken Grotesk and Martian Mono (SIL Open Font License). Move generation:{" "}
          <a href="https://github.com/jhlywa/chess.js">chess.js</a> (BSD-2-Clause).
        </p>
      </main>
    </div>
  );
}
