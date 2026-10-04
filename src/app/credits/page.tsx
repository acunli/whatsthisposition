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

        <h2>Game review</h2>
        <p>
          Every position of the game is searched by Stockfish in your browser, and each move is judged by how much of the mover&apos;s winning
          chances it gives up compared with the engine&apos;s best move. The bands follow Chess.com&apos;s published expected-points model, and
          winning chances use Lichess&apos;s win-percentage curve. <b>Brilliant</b> needs a real sacrifice: material left or put where it can be
          taken, checked with exchange arithmetic on the board, not guessed from the score. Moves that decide those labels are searched a second
          time, deeper, before the label is final. Accuracy uses Lichess&apos;s published formula.
        </p>
        <p>
          Games you import from Chess.com or Lichess are fetched through this site from their free public APIs and aren&apos;t stored. The opening
          book is the Lichess <a href="https://github.com/lichess-org/chess-openings">chess-openings</a> dataset (CC0). The Brilliant and Great
          checks were informed by <a href="https://github.com/WintrCat/wintrchess">WintrChess</a> (GPL-3.0); our version is written independently.
        </p>

        <h2>Privacy</h2>
        <p>
          Analysis and game review run entirely in your browser. If you upload a photo, it goes to this site&apos;s server and on to the configured vision API (the NUS SoCLaaS gateway, or Anthropic&apos;s API)
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
          Type: Clash Display and Satoshi by Indian Type Foundry via Fontshare (ITF Free Font License); Instrument Serif and Geist Mono (SIL Open Font License).
          3D: three.js and React Three Fiber (MIT). Move generation:{" "}
          <a href="https://github.com/jhlywa/chess.js">chess.js</a> (BSD-2-Clause).
        </p>
      </main>
    </div>
  );
}
