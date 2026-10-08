# what’sthisposition for Chess.com (browser extension)

When a Chess.com game ends, a card pops up in the corner of the page with an **Analyze** button. Press it and the game is reviewed on your own computer: both players' accuracy and how many Brilliant, Great, Best… Blunder moves each made. **See every move explained** then opens the full step-by-step review on what’sthisposition.

It pops up for a game that has just ended: one you watched end, or one that ended in the last 10 minutes (Chess.com doesn't always show a game's id while it's being played). On older games a small **Review with what’sthisposition** button offers the same. Close the card and it stays closed for that game until you reopen it from the button.

## Install it now (unpacked)

```bash
npm install
npm run ext:build          # builds extension/dist
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Select **Load unpacked** and choose the `extension/dist` folder.
3. Open a finished game on Chess.com (for example from your profile's game archive).

It works in any Chromium browser (Chrome, Edge, Brave, Arc, Opera).

## Publish it on the Chrome Web Store

1. `npm run ext:zip` builds `extension/whatsthisposition-extension-<version>.zip` (the version comes from `package.json`).
2. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (a one-time $5 fee) and select **New item**, then upload the zip.
3. Fill in the listing:
   - **Single purpose:** "Reviews a finished Chess.com game: accuracy and move labels, with a link to a full explanation."
   - **Permissions:** `offscreen`, justified as "Runs the Stockfish chess engine in a hidden extension page to review the finished game on the user's computer." It also runs on `https://www.chess.com/*`, where it reads the page's own game data (the JSON Chess.com's game page loads) to get the moves.
   - **Data usage:** it collects nothing. The analysis runs on the user's computer; the review link carries the game in the URL's fragment (`#review=…`), which is never sent to a server.
   - **Screenshots:** at least one at 1280×800, e.g. the card next to a finished game.
4. Submit for review. Updates: bump `version` in `package.json`, `npm run ext:zip`, upload.

`EXT_SITE_URL=https://whatsthisposition.com npm run ext:zip` points the review link at another address (the default is `https://whatsthisposition.vercel.app`, which keeps working after a custom domain is added).

## Fair play

It only acts on **finished** games: Chess.com's own game data (`isFinished`) decides, so nothing is shown or analysed while a game is in progress. That is the same as reviewing a game on Chess.com afterwards.

## How it works

- **`src/content.ts`** runs on Chess.com. It finds the game on screen from, in order: the URL (`/game/live/…`, `/game/daily/…`, `/game/…`, `/analysis/game/…`); Chess.com's own **Game Review** button, which links to `/analysis/game/live/{id}?tab=review` (in the game-over box and in the side panel); the newest game linked elsewhere on the page; and, when the page names no game (a game started with "New 1 min" can stay on `/play/online`), the signed-in player's public game list on `api.chess.com`, for a game that ended while the page was open (it appears there about a minute after the game). Then it asks Chess.com's game endpoint (`/callback/live/game/{id}`) whether the game is over. Chess.com's endpoint doesn't serve a live game until it has ended (it answers 404) and it rate-limits quick repeats, so a game in progress is checked only every 15 seconds (daily games every 30); the moment the page shows the result box or the Game Review button, it checks at once and every 2 seconds until the game is served, so the card comes up seconds after the game ends. When the game has just ended (seen ending, or ended less than 10 minutes ago, from its `endTime`), the card opens; otherwise the small button appears.
- **The card** is `panel.html`, an extension page in an iframe, so its scripts and styles are separate from Chess.com's.
- **Stockfish runs in a hidden engine page** (`engine.html`, an offscreen document that `src/background.ts` opens on demand and closes when no card needs it). The card sits inside Chess.com's page, and there the browser may refuse to start workers ("The engine failed to load"); the engine page is the extension's own, so it can. The card sends it searches over a runtime port (`src/remoteEngine.ts`) and falls back to workers in the card if the engine page can't open. If neither starts, the card says why and offers the review on the website instead.
- **`src/panel.ts`** decodes the moves (Chess.com's compact TCN encoding, `src/lib/review/chesscomGame.ts`) into a PGN and runs **the website's own review** (`src/lib/review`): Stockfish 19 in Web Workers (`engine/`), the same labels, the same accuracy formula and the same opening book (`data/`), at the same default depth (Thorough, 18; Fast and Standard are one click away). Critical moments are searched deeper, as on the site.
- **The link** opens `/#review=<PGN>&as=<your colour>&depth=<depth>`, and the site starts that review straight away.

Everything is bundled from this repository by `build.mjs` (esbuild), so the extension and the site always label moves the same way.

## Licence

GPL-3.0-or-later, like the site (it ships Stockfish). `engine/COPYING.txt` and `LICENSE` are included in the package.
