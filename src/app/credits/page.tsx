import Link from "next/link";

export const metadata = { title: "Notes & licences — WhatsThisPosition" };

export default function Credits() {
  return (
    <div className="app">
      <header className="masthead">
        <Link href="/" className="wordmark" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="wordmark-a">Whats</span>
          <span className="wordmark-b">This</span>
          <span className="wordmark-a">Position</span>
          <span className="wordmark-q">?</span>
        </Link>
        <p className="masthead-tag">Notes, privacy and licences</p>
        <nav className="masthead-nav">
          <Link className="navlink" href="/">
            ← Back to the board
          </Link>
        </nav>
      </header>
      <main className="prose">
        <h1>How this works</h1>
        <p>
          Everything you see on the board comes from one of three sources, and each explanation is tagged with it:
          <b> Board fact</b> (worked out from the position and the rules alone), <b>Engine</b> (from Stockfish&apos;s search), or
          <b> Idea</b> (a strategic interpretation the engine hasn&apos;t confirmed). The app never splits the evaluation into
          percentages for king safety, material and so on, because the engine doesn&apos;t report that.
        </p>
        <p>Short explanations are written from templates over those facts. No language model writes or changes them.</p>

        <h2>Privacy</h2>
        <p>
          Analysis runs entirely in your browser. If you upload a photo, it is sent to this site&apos;s server and forwarded to
          Anthropic&apos;s API to read the pieces. It is kept in memory for that request only and isn&apos;t saved by
          WhatsThisPosition. Anthropic processes it under its own API data policy. FEN and manual setup never leave your device.
        </p>

        <h2>Stockfish</h2>
        <p>
          The engine is{" "}
          <a href="https://github.com/nmrugg/stockfish.js" rel="noreferrer">
            Stockfish.js
          </a>{" "}
          (Stockfish 19, lite single-threaded WebAssembly build) by Nathan Rugg and Chess.com, based on{" "}
          <a href="https://stockfishchess.org" rel="noreferrer">
            Stockfish
          </a>{" "}
          by the Stockfish developers. It is free software under the GNU General Public License v3. The files are served from
          this site (<code>/engine/stockfish.js</code>, <code>/engine/stockfish.wasm</code>), with the full licence at{" "}
          <a href="/engine/COPYING.txt">/engine/COPYING.txt</a>. Source code for the engine is available from the Stockfish.js
          repository above. This website&apos;s own source is also offered under the GPL v3 or later.
        </p>

        <h2>Pieces and libraries</h2>
        <p>
          Piece artwork: the “cburnett” set by Colin M.L. Burnett, as packaged in Lichess&apos;s{" "}
          <a href="https://github.com/lichess-org/chessground" rel="noreferrer">
            chessground
          </a>{" "}
          (GPL v3+). Move generation: <a href="https://github.com/jhlywa/chess.js">chess.js</a> (BSD-2-Clause).
        </p>
      </main>
    </div>
  );
}
