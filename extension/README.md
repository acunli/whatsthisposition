# what’sthisposition for Chess.com (browser extension)

Finish a game on Chess.com (or open one of yours) and click the extension's button in the toolbar: it names the game and offers **Review this game**, which opens a card in the bottom-right corner of the page. Press **Analyze** there and the game is reviewed on your own computer: both players' accuracy and how many Brilliant, Great, Best… Blunder moves each made. **See every move explained** then opens the full step-by-step review on what’sthisposition, carrying the finished review with it, so the website shows it at once instead of searching again.

Tip: pin the extension (the puzzle-piece icon → the pin) so its button is always in the toolbar.

## Install it now (unpacked)

```bash
npm install
npm run ext:build          # builds extension/dist
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Select **Load unpacked** and choose the `extension/dist` folder.
3. Finish a game on Chess.com, or open one of yours, and click the extension's toolbar button.

It works in any Chromium browser (Chrome, Edge, Brave, Arc, Opera).

## Publish it on the Chrome Web Store

1. `npm run ext:zip` builds `extension/whatsthisposition-extension-<version>.zip` (the version comes from `package.json`).
2. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (a one-time $5 fee) and select **New item**, then upload the zip.
3. Fill in the listing:
   - **Single purpose:** "Reviews a finished Chess.com game: accuracy and move labels, with a link to a full explanation."
   - **Permissions:** `offscreen` ("Runs the Stockfish chess engine in a hidden extension page to review the finished game on the user's computer"), `activeTab` and `scripting` ("When the user clicks the toolbar button on a Chess.com tab, finds the game on that page and opens the review card there, adding the extension's script if the tab was opened before the extension was installed"). It runs on `https://www.chess.com/*`, where it reads the page's own game data (the JSON Chess.com's game page loads) to get the moves, and on request reads the signed-in player's public game list from `api.chess.com`.
   - **Data usage:** it collects nothing. The analysis runs on the user's computer; the review link carries the game in the URL's fragment (`#review=…`), which is never sent to a server.
   - **Screenshots:** at least one at 1280×800, e.g. the card next to a finished game.
4. Submit for review. Updates: bump `version` in `package.json`, `npm run ext:zip`, upload.

`EXT_SITE_URL=https://whatsthisposition.com npm run ext:zip` points the review link at another address (the default is `https://whatsthisposition.vercel.app`, which keeps working after a custom domain is added).

## Fair play

It does nothing until you click its button, and it only reviews **finished** games: Chess.com's own game data (`isFinished`) decides, so a game in progress is never analysed. That is the same as reviewing a game on Chess.com afterwards.

## How it works

- **`src/popup.ts`** is the toolbar button's popup. It asks the Chess.com tab which game is there and, on **Review this game**, asks it to open the card. If the tab was opened before the extension, it adds the script to it first (`activeTab` + `scripting`).
- **`src/content.ts`** runs on Chess.com and waits to be asked. It finds the game from, in order: the URL (`/game/live/…`, `/game/…`, `/game/daily/…`, `/analysis/game/…`); Chess.com's **Game Review** button, a link to `/analysis/game/live/{id}?tab=review` (in the result box and the side panel); the newest game linked on the page; and, if the page names none, the signed-in player's newest game from their public game list. It reads the game from Chess.com's game endpoint (`/callback/live/game/{id}`), which serves a live game only once it has ended.
- **The card** is `panel.html`, an extension page in an iframe, so its scripts and styles are separate from Chess.com's.
- **Stockfish runs in a hidden engine page** (`engine.html`, an offscreen document that `src/background.ts` opens on demand and closes when no card needs it). The card sits inside Chess.com's page, and there the browser may refuse to start workers ("The engine failed to load"); the engine page is the extension's own, so it can. The card sends it searches over a runtime port (`src/remoteEngine.ts`) and falls back to workers in the card if the engine page can't open. If neither starts, the card says why and offers the review on the website instead.
- **`src/panel.ts`** decodes the moves (Chess.com's compact TCN encoding, `src/lib/review/chesscomGame.ts`) into a PGN and runs **the website's own review** (`src/lib/review`): Stockfish 19 in Web Workers (`engine/`), the same labels, the same accuracy formula and the same opening book (`data/`), at the same default depth (Thorough, 18; Fast and Standard are one click away). Critical moments are searched deeper, as on the site.
- **The link** opens `/#review=<PGN>&as=<your colour>&depth=<depth>&data=<review>`. `data` is the finished review (every position's depth, evaluation and engine lines, packed and gzipped by `packReview` in `src/lib/review/share.ts`; about 4–8 KB for a whole game), so the site shows the review at once without running Stockfish. All of it is in the URL's fragment, which is never sent to a server.

Everything is bundled from this repository by `build.mjs` (esbuild), so the extension and the site always label moves the same way.

## Licence

GPL-3.0-or-later, like the site (it ships Stockfish). `engine/COPYING.txt` and `LICENSE` are included in the package.
