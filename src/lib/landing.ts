/**
 * The pages people find from a search: one per thing they search for (a Chess.com review, a
 * Lichess review, a PGN, a single position, the extension, what the labels mean). Each page has
 * the working tool or the facts it promises, its own questions (shown on the page and given to
 * search engines as FAQPage data), and a title and description written for the search result.
 * Keep every answer true to the code, like lib/faq.ts.
 */
import type { FaqItem } from "./faq";

export interface Landing {
  path: `/${string}`;
  /** The search result's title, before " · what’sthisposition". */
  title: string;
  /** The search result's snippet: under about 160 characters, so it isn't cut off. */
  description: string;
  /** What the page is called in the footer and in links from other pages. */
  name: string;
  h1: string;
  lede: string;
  faq: FaqItem[];
}

export const LANDING = {
  chesscom: {
    path: "/chess-com-game-review",
    title: "Free Chess.com game review, no daily limit",
    description:
      "Review your Chess.com games free, with no daily limit. Enter your username, pick a game, and Stockfish labels and explains every move, Brilliant to Blunder.",
    name: "Chess.com game review",
    h1: "Chess.com game review, free and without a daily limit.",
    lede: "Type your Chess.com username and pick one of your recent games, or paste a game link or its PGN. Stockfish labels every move from Brilliant to Blunder, explains why, and gives both players' accuracy.",
    faq: [
      {
        q: "Is there a limit on how many Chess.com games I can review?",
        a: "No. Every review runs on your own device, so there is no daily limit, no account and nothing to pay. Review as many games as you like.",
      },
      {
        q: "Which Chess.com games can I review?",
        a: "Any standard game, live or daily, rated or casual, from bullet to classical. Your username lists your games from the last three months; for an older game, paste its link or PGN. Variants like Chess960 can't be reviewed.",
      },
      {
        q: "Do I need to sign in to Chess.com?",
        a: "No. Finished Chess.com games are public: the site reads your games from Chess.com's free public API, and a linked game from its own page. Nothing is stored.",
      },
      {
        q: "Will my accuracy match Chess.com's?",
        a: "Usually within about 3 to 4 points. The score is fitted on games Chess.com reviewed, but the engines and search depths differ, so a few moves can get a different label.",
      },
      {
        q: "Is this made by Chess.com?",
        a: "No. It's an independent, open-source project, not affiliated with or endorsed by Chess.com.",
      },
    ],
  },
  lichess: {
    path: "/lichess-game-review",
    title: "Lichess game review with every move explained",
    description:
      "Review Lichess games by username or game link. Stockfish labels every move from Brilliant to Blunder, explains why and scores accuracy, free in your browser.",
    name: "Lichess game review",
    h1: "Lichess game review, every move labelled and explained.",
    lede: "Enter your Lichess username or paste a game link. Each move gets a label from Brilliant to Blunder and a reason in plain words, and both players get an accuracy score.",
    faq: [
      {
        q: "Do I need a Lichess account or API token?",
        a: "No. Lichess lists anyone's games without a login, so a username or a game link is all it takes.",
      },
      {
        q: "Can I review a game from a Lichess study?",
        a: "Yes: in the study, open Share & export, copy the chapter's PGN and paste it in the PGN tab.",
      },
      {
        q: "Why is the accuracy different from the one on Lichess?",
        a: "It uses Lichess's formula for each move, but the game score is put on Chess.com's scale, fitted on games Chess.com reviewed. That makes it comparable with your friends' Chess.com numbers, and different from Lichess's own.",
      },
      {
        q: "Which Lichess games can be reviewed?",
        a: "Standard chess at any time control, including games started from a position. Variants such as Crazyhouse or Chess960 can't be reviewed.",
      },
    ],
  },
  pgn: {
    path: "/pgn-analyzer",
    title: "PGN analyzer: paste a chess game, get a full review",
    description:
      "Paste a PGN or drop a .pgn file to review any chess game. Stockfish labels and explains every move and gives accuracy and the opening, free in your browser.",
    name: "PGN analyzer",
    h1: "PGN analyzer: paste a game, review every move.",
    lede: "Paste a PGN from any site or app, or drop the .pgn file on the page. Stockfish labels every move from Brilliant to Blunder and explains why, right in your browser.",
    faq: [
      {
        q: "What is a PGN?",
        a: "Portable Game Notation: the plain-text format for chess games. The players, date and result sit in square brackets at the top and the moves follow. Every chess site and app can export it.",
      },
      {
        q: "Can I review a game that starts from a set-up position?",
        a: "Yes. A PGN with a FEN header (as sites write for games from a position) is replayed from that position.",
      },
      {
        q: "What happens to the comments and variations in my file?",
        a: "The review follows the game's main line; comments, side variations and annotation symbols are skipped. During the review you can play your own moves on the board, and they're analysed as a side line.",
      },
      {
        q: "Is my PGN uploaded?",
        a: "No. It's read and analysed in your browser and never leaves your device.",
      },
    ],
  },
  position: {
    path: "/chess-position-analyzer",
    title: "Chess position analyzer: screenshot, FEN or setup",
    description:
      "Analyse any chess position from a screenshot, a FEN or a board you set up. See the threats, weaknesses and plans for both sides, checked by Stockfish.",
    name: "Position analyzer",
    h1: "Chess position analyzer, from a screenshot, a FEN or a board.",
    lede: "Drop a screenshot of a board, paste a FEN or set up the pieces. You get the evaluation and the reasons behind it: threats, weaknesses, strengths and plans for both sides, drawn on the board.",
    faq: [
      {
        q: "Where do I find a position's FEN?",
        a: "Most chess sites show it on their analysis board, often under Share or below the board. Or skip the FEN and drop a screenshot instead.",
      },
      {
        q: "Does it guess whose move it is?",
        a: "No. A picture can't show whose turn it is, whether castling is still allowed or if en passant is possible, so you set those. Which side is at the bottom is guessed, with a one-click swap.",
      },
      {
        q: "Is my screenshot uploaded?",
        a: "No. A small neural network reads the board on your device, and the picture never leaves your browser.",
      },
      {
        q: "Can I share an analysis?",
        a: "Yes. The address keeps the position (?fen=…), so the link opens the same analysis for anyone.",
      },
    ],
  },
  extension: {
    path: "/chess-com-extension",
    title: "Chess.com game review extension for Chrome, free",
    description:
      "A free Chrome extension that reviews your finished Chess.com games on the game page: accuracy for both players and every move labelled, Brilliant to Blunder.",
    name: "Chess.com extension",
    h1: "Chess.com game review, right on the game page.",
    lede: "The free extension reviews a finished Chess.com game right where you played it: both players' accuracy and every move counted, from Brilliant to Blunder. One more click opens the whole review here, already done.",
    faq: [
      {
        q: "Does it work during a game?",
        a: "No. It only reviews games that are over: Chess.com's own game data decides, so a game in progress is never analysed. It's the same as reviewing a game on Chess.com afterwards.",
      },
      {
        q: "Which browsers does it work in?",
        a: "Chrome, Edge, Brave, Arc, Opera and other Chromium browsers on a computer. Firefox, Safari and phones aren't supported; on a phone, enter your username on this site instead.",
      },
      {
        q: "Can it review my older games?",
        a: "Yes. Open any of your finished games on Chess.com and click the extension's button.",
      },
      {
        q: "Does the extension cost anything?",
        a: "No. No subscription, no limits and no ads. The code is open source under the GPL-3.0 licence.",
      },
    ],
  },
  labels: {
    path: "/chess-move-classifications",
    title: "Chess move classifications explained: Brilliant to Blunder",
    description:
      "What Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss and Blunder mean in a chess game review, and the exact rule behind each label.",
    name: "Move classifications explained",
    h1: "Chess move classifications, explained.",
    lede: "Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder and Forced: what each label means, and the exact rule this site's game review uses to give it.",
    faq: [
      {
        q: "What is a brilliant move in chess?",
        a: "A good sacrifice: the best move in the position, and it really gives material away. You must not be worse after it, and you must not have been completely winning without it.",
      },
      {
        q: "What's the difference between Best and Great?",
        a: "Best is the engine's top move. Great is a Best move that was also the only good one: every alternative gives away at least 10% of your winning chances.",
      },
      {
        q: "What is a Miss?",
        a: "Your opponent had just made a mistake or a blunder, and your reply let the chance go: it gives back at least 10% of your winning chances, though you end up no worse than before their mistake.",
      },
      {
        q: "Is a Blunder always a losing move?",
        a: "No. A blunder gives away 20% or more of your winning chances, or walks into a forced mate. From a winning position, a blunder can leave you only equal.",
      },
      {
        q: "Why is my move Excellent and not Best?",
        a: "Best is only the engine's top choice. A different move that costs under 2% of your winning chances is Excellent: in practice just as good.",
      },
    ],
  },
} satisfies Record<string, Landing>;

/** Every landing page, in the order the footer lists them. */
export const LANDINGS: Landing[] = [LANDING.chesscom, LANDING.lichess, LANDING.pgn, LANDING.position, LANDING.extension, LANDING.labels];
