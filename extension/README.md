# what’sthisposition for Chess.com (browser extension)

When a Chess.com game ends, a card pops up in the corner of the page with an **Analyze** button. Press it and the game is reviewed on your own computer: both players' accuracy and how many Brilliant, Great, Best… Blunder moves each made. **See every move explained** then opens the full step-by-step review on what’sthisposition.

On a game that was already over when you opened it, a small **Review with what’sthisposition** button offers the same.

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
   - **Permissions:** none besides running on `https://www.chess.com/*`. It reads that page's own game data (the JSON Chess.com's game page loads) to get the moves.
   - **Data usage:** it collects nothing. The analysis runs on the user's computer; the review link carries the game in the URL's fragment (`#review=…`), which is never sent to a server.
   - **Screenshots:** at least one at 1280×800, e.g. the card next to a finished game.
4. Submit for review. Updates: bump `version` in `package.json`, `npm run ext:zip`, upload.

`EXT_SITE_URL=https://whatsthisposition.com npm run ext:zip` points the review link at another address (the default is `https://whatsthisposition.vercel.app`, which keeps working after a custom domain is added).

## Fair play

It only acts on **finished** games: Chess.com's own game data (`isFinished`) decides, so nothing is shown or analysed while a game is in progress. That is the same as reviewing a game on Chess.com afterwards.

## How it works

- **`src/content.ts`** runs on Chess.com. It finds the game on screen from the URL (`/game/live/…`, `/game/daily/…`, `/game/…`, `/analysis/game/…`) or, on the play page, from the links in the game-over box, and asks Chess.com's game endpoint (`/callback/live/game/{id}`) whether it is over. A game that is still going is checked every 3 seconds (daily games every 30). When it ends while you watch, the card opens; otherwise the small button appears.
- **The card** is `panel.html`, an extension page in an iframe, so its scripts and styles are separate from Chess.com's.
- **`src/panel.ts`** decodes the moves (Chess.com's compact TCN encoding, `src/lib/review/chesscomGame.ts`) into a PGN and runs **the website's own review** (`src/lib/review`): Stockfish 19 in Web Workers (`engine/`), the same labels, the same accuracy formula and the same opening book (`data/`), at the same default depth (Thorough, 18; Fast and Standard are one click away). Critical moments are searched deeper, as on the site.
- **The link** opens `/#review=<PGN>&as=<your colour>&depth=<depth>`, and the site starts that review straight away.

Everything is bundled from this repository by `build.mjs` (esbuild), so the extension and the site always label moves the same way.

## Licence

GPL-3.0-or-later, like the site (it ships Stockfish). `engine/COPYING.txt` and `LICENSE` are included in the package.
