import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { SITE_NAME, SOURCE_URL } from "@/lib/brand";

export const metadata = {
  title: { absolute: `How it works, privacy and credits · ${SITE_NAME}` },
  description: "How the free chess game review labels and explains every move with Stockfish 19 in your browser, what data it keeps (none of your games), and the open-source projects it builds on.",
  alternates: { canonical: "/credits" },
};

export default function Credits() {
  return (
    <div className="shell">
      <PageTopbar />
      <main className="prose">
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
          time, deeper, before the label is final. Accuracy uses Lichess&apos;s per-move formula, put on Chess.com&apos;s scale by fitting it to
          Chess.com&apos;s own reviews of real games.
        </p>
        <p>
          Games you import from Chess.com or Lichess are fetched through this site from their free public APIs (a Chess.com game link, from
          Chess.com&apos;s own game data) and aren&apos;t stored. Opening
          names come from the Lichess <a href="https://github.com/lichess-org/chess-openings">chess-openings</a> dataset (CC0). How deep theory
          goes, and what strong players play in each position, comes from 1.84 million games between strong players: over-the-board games from
          the <a href="https://database.lichess.org/#broadcasts">Lichess broadcast database</a> (CC BY-SA 4.0; this site&apos;s book is a
          derived statistics table, shared under the same licence), and online games from the{" "}
          <a href="https://database.nikonoel.fr/">Lichess Elite Database</a> by nikonoel, a selection of the CC0{" "}
          <a href="https://database.lichess.org/">Lichess database</a>. The Brilliant and Great checks were informed by{" "}
          <a href="https://github.com/WintrCat/wintrchess">WintrChess</a> (GPL-3.0); our version is written independently.
        </p>

        <h2 id="privacy">Privacy</h2>
        <p>
          Analysis and game review run entirely in your browser. Screenshots and photos are read on your device by a small neural network
          trained on open-source piece sets; they never leave your browser. Only if you choose the optional AI reader (for angled photos of a
          real board) is the cropped picture sent through this site&apos;s server to the configured vision API (the NUS SoCLaaS gateway, or
          Anthropic&apos;s API), held in memory for that request and discarded. FEN and hand setup never leave your device. The game you
          are reviewing is kept in that browser tab, so reloading the review page shows it again; it is never sent anywhere and is gone
          when you close the tab.
        </p>
        <p>
          A game is stored only if you press <b>Share review</b> on it. That makes a public link: the game&apos;s moves and names as its PGN
          has them, the finished review, and a summary for the link&apos;s preview card (both accuracies and the labelled moves), kept for a
          year. Anyone with the link can open it; shared reviews aren&apos;t listed anywhere or indexed by search engines.
        </p>
        <p>
          To know how many people use it and how well it works for them, the site counts visits and uses anonymously, without cookies: when
          you open a page, start a review or an analysis, read a photo or click Add to Chrome, it sends only what kind of use it was, where it
          started and on which page (for example &ldquo;review, from a Chess.com username&rdquo;, or &ldquo;arrived from Google&rdquo;: the
          name of the referring site or app, never its address), never the game, position, photo or username. With each page load it also
          sends a few rough classes of your device (window width, touch or mouse, light or dark theme, the number of processor threads), how
          long the page stayed open and how fast it loaded. The server adds your device type, system and browser family, and the country,
          region, city and time zone that the host works out from your IP address, and counts everything per hour. To tell visitors apart
          within a month it uses a code made from your IP address and browser that is never stored and can&apos;t be linked to another
          month. Your browser&apos;s Do Not Track or Global Privacy Control setting turns this counting off. Page views also go to Vercel Web
          Analytics (the site&apos;s host), which is cookieless too and keeps no personal identifiers.
        </p>
        <p>
          The browser extension for Chess.com collects nothing. It works only on chess.com, where it looks at the game on the page to
          know when it ends, and then opens its review card (or when you click its button). It reads the finished game from the page or
          from Chess.com&apos;s own game data (or, if the page names no game, your public game list from Chess.com&apos;s API), and
          Stockfish reviews it on your computer when you press Analyze; nothing is sent to this site or anyone else. It keeps two things
          in your browser, never sent anywhere: whether the automatic card is on, and which games&apos; cards have already opened.
          &ldquo;See every move explained&rdquo; opens this site with the game after the # in the address, a part browsers never send to a
          server, and the site counts that visit as described above.
        </p>

        <h2>Stockfish</h2>
        <p>
          The engine is <a href="https://github.com/nmrugg/stockfish.js">Stockfish.js</a> (Stockfish 19, lite single-threaded
          WebAssembly build) by Nathan Rugg and Chess.com, based on <a href="https://stockfishchess.org">Stockfish</a> by the
          Stockfish developers. It&apos;s free software under the GNU General Public License v3, served from this site with its licence at{" "}
          <a href="/engine/COPYING.txt">/engine/COPYING.txt</a>. Engine source is available from the Stockfish.js repository.
          This website&apos;s own source code is free software under the GPL v3 or later, at{" "}
          <a href={SOURCE_URL}>{SOURCE_URL.replace("https://", "")}</a>.
        </p>

        <h2>Pieces, type and libraries</h2>
        <p>
          Piece set: “mpchess” by Maxime Chupin (GPL-3.0+), as distributed with <a href="https://github.com/lichess-org/lila">Lichess</a>.
          Type: Archivo by Omnibus-Type (SIL Open Font License).
          The 3D knight on the home page: from <a href="https://polyhaven.com/a/chess_set">“Chess Set”</a> by Riley Queen on Poly Haven (CC0).
          3D: three.js and React Three Fiber (MIT). Move generation:{" "}
          <a href="https://github.com/jhlywa/chess.js">chess.js</a> (BSD-2-Clause).
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
