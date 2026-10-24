/**
 * Questions people ask before trying the site. Shown on the home page and given to search
 * engines as FAQPage structured data (app/page.tsx), so both always say the same thing.
 * Keep the answers true to the code: they quote its rules and numbers.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: "Is it really free?",
    a: "Yes. There is no account, no daily limit and nothing to unlock. Stockfish runs on your own device, so a review costs nothing to serve. The code is open source (GPL-3.0).",
  },
  {
    q: "How do I review my Chess.com games?",
    a: "Type your Chess.com username and pick a game from your last three months, or paste the link of any game. You can also paste the PGN (Share, then PGN, on Chess.com), or add the Chrome extension and review a game right on its Chess.com page.",
  },
  {
    q: "Can I review Lichess games or a PGN file?",
    a: "Yes. Enter a Lichess username or paste a game link. Any PGN works too: paste it, or drop the .pgn file on the page. Files with several games let you pick one.",
  },
  {
    q: "How are moves labelled?",
    a: "Each move is compared with Stockfish's best by how much of your winning chances it gives away: under 2% is Excellent, under 5% Good, then Inaccuracy, Mistake, and Blunder at 20% or more. Brilliant needs a real sacrifice that is also the best move; Great is the only move that holds.",
  },
  {
    q: "How close is the accuracy to Chess.com's?",
    a: "The accuracy score is fitted on games Chess.com reviewed, and usually lands within about 3 to 4 points of Chess.com's number for the same game.",
  },
  {
    q: "Is my game uploaded anywhere?",
    a: "No. Games, positions and photos stay in your browser. A username or game link is only used to fetch your public games from Chess.com or Lichess. Visits are counted anonymously, without cookies.",
  },
  {
    q: "Can it explain a single position or a screenshot?",
    a: "Yes. Drop a screenshot or photo of a board, paste a FEN or set up the pieces by hand. It shows the threats, weaknesses and plans for both sides on the board, checked by Stockfish.",
  },
];
