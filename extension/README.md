# what’sthisposition for Chess.com (browser extension)

Finish a game on Chess.com and a card pops up in the bottom-right corner of the page. (For a past game, open it and click the extension's button in the toolbar, then **Review this game**; the same popup turns the automatic card off.) Press **Analyze** in the card and the game is reviewed on your own computer: both players' accuracy and how many Brilliant, Great, Best… Blunder moves each made. **See every move explained** then opens the full step-by-step review on what’sthisposition, carrying the finished review with it, so the website shows it at once instead of searching again.

Tip: pin the extension (the puzzle-piece icon → the pin) so its button is always in the toolbar.

**[Add it to Chrome from the Chrome Web Store](https://chromewebstore.google.com/detail/bngblpcelnjnhbmaljgelkddkfhjneka)** (free; also works in Edge, Brave, Opera and other Chromium browsers).

## Build it from source (unpacked)

```bash
npm install
npm run ext:build          # builds extension/dist
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Select **Load unpacked** and choose the `extension/dist` folder.
3. Play a game on Chess.com: the card opens when it ends. Or open a finished game and click the extension's toolbar button.

### Testing the automatic card

- After **Reload** in `chrome://extensions` there's no need to reload the Chess.com tabs: the extension adds its script to them again, and the old copy stops.
- Play any game (a 1-minute game, or one against the computer). The card should open within about a second of the result appearing.
- Each game's card opens once: reloading the page doesn't open it again (the toolbar button still does).
- The toolbar popup says what the page is doing ("Watching this game: the card opens when it ends").
- To see each step, open DevTools on the Chess.com tab, set the console's level to include **Verbose**, and filter on `what’sthisposition`: it logs the game's id, Chess.com's answers, when the game ended and why the card opened (or why not).

It works in any Chromium browser (Chrome, Edge, Brave, Arc, Opera).

## Publish it on the Chrome Web Store

1. `npm run ext:zip` builds `extension/whatsthisposition-extension-<version>.zip` (the version comes from `package.json`).
2. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (a one-time $5 fee) and select **New item**, then upload the zip.
3. Fill in the listing:
   - **Single purpose:** "Reviews a finished Chess.com game: accuracy and move labels, with a link to a full explanation."
   - **Permissions:** `offscreen` ("Runs the Stockfish chess engine in a hidden extension page to review the finished game on the user's computer"), `activeTab` and `scripting` ("When the user clicks the toolbar button on a Chess.com tab, finds the game on that page and opens the review card there; after an install or update, adds the extension's script to Chess.com tabs that were already open, so the card works there without a reload"), `storage` ("Remembers whether the automatic review card is on, and which games' cards have already opened, so reloading a page doesn't open one again"). It runs on `https://www.chess.com/*`, where it reads the page's own game data (the JSON Chess.com's game page loads) to get the moves, and on request reads the signed-in player's public game list from `api.chess.com`.
   - **Host permission** (`https://www.chess.com/*`, for the content script and `host_permissions`): watches the game on the page to open the review card when it ends, reads the finished game's moves from the page or Chess.com's own game data, and adds its script to Chess.com tabs that were open before an install or update; if the page names no game, reads the signed-in player's public game list from `api.chess.com`. It adds no warning beyond the content script's ("Read and change your data on www.chess.com").
   - **Remote code:** no. All the JavaScript and the Stockfish WebAssembly are in the package; only game data (JSON) comes from Chess.com.
   - **Privacy policy:** `https://www.whatsthisposition.com/credits#privacy` (it has a paragraph on the extension).
   - **Data usage:** it collects nothing: tick none of the data types, and tick the three certifications. The analysis runs on the user's computer; the review link carries the game in the URL's fragment (`#review=…`), which is never sent to a server.
   - **Store listing:** everything is in [`store/`](store): the description (`description.txt`; its first lines and the manifest's `name` and `description`, the listing's title and summary, carry what people search the store for: chess game review, analysis, Chess.com, Stockfish, accuracy; but no lists of names: 1.0.3 was rejected as "excessive keywords" (Yellow Argon) for a list of browsers, so name things in sentences, not lists), the store icon (`icon-128.png`, 96×96 artwork with 16 px of transparent padding), four 1280×800 screenshots and the small (440×280) and marquee (1400×560) promo tiles, all JPEG without alpha as the store asks. Category Games, language English, homepage `https://www.whatsthisposition.com`, support `https://github.com/acunli/whatsthisposition/issues`.
4. Submit for review. Updates: bump `version` in `package.json`, `npm run ext:zip`, upload.

The review link opens `https://www.whatsthisposition.com` (the site's primary address; the bare domain redirects there, keeping the `#review=…` part). `EXT_SITE_URL=https://whatsthisposition.vercel.app npm run ext:zip` points it at another address, e.g. a preview deployment.

## Fair play

The card opens only once a game is **over**: when the page shows the result under the moves, or Chess.com's own game data says `isFinished`. The moves are read only then, and nothing is analysed until you press **Analyze**, so a game in progress is never analysed. That is the same as reviewing a game on Chess.com afterwards.

It never touches Chess.com's own scripts: the board's JavaScript API (`wc-chess-board`'s `game`) has a `CheatDetectionError` listener, and an extension calling it during a game would look like a cheating tool. The page script only reads the page (how many moves the list shows, and the result), and asks Chess.com for a live game's data at most once while it's played, plus a backstop every 60 s (30 s when no move list shows); a live game answers 404 until it ends.

## How it works

- **`src/popup.ts`** is the toolbar button's popup. It asks the Chess.com tab which game is there and, on **Review this game**, asks it to open the card. If the tab was opened before the extension, it adds the script to it first (`activeTab` + `scripting`).
- **`src/content.ts`** runs on Chess.com and opens the card when a game ends. It watches two things, either of which is enough:
  - **The move list on the page** (`wc-simple-move-list`: a `.node.main-line-ply` per move, then `.game-result` with "1-0" when it's over). `MoveListWatch` (`src/lib/review/chesscomPage.ts`) calls a game live once moves are seen being added (or it has shown no result for 8 s), so a game opened already finished doesn't count; its end is the result appearing. This needs no game id, so it works on `/play/online` and against the computer too.
  - **Chess.com's game data** for the game named by the address or, once it's over, the Game Review button: 404 while a live game is played, then `isFinished`. A game opened within 10 minutes of its end also opens the card.

  The card shows Chess.com's copy of the game (full headers) if it arrives within 4 s, else the moves read off the page (figurine notation included), checked move by move with chess.js. Each game's card opens once (its id and moves are remembered in `chrome.storage.local`). A copy of the script left from before an update or reload stops itself when the new one starts. For the toolbar button it finds the game from, in order: the URL (`/game/live/…`, `/game/…`, `/game/daily/…`, `/analysis/game/…`); Chess.com's **Game Review** button, a link to `/analysis/game/live/{id}?tab=review` (in the result box and the side panel); the newest game linked on the page; and, if the page names none, the signed-in player's newest game from their public game list. It reads the game from Chess.com's game endpoint (`/callback/live/game/{id}`), which serves a live game only once it has ended.
- **`src/background.ts`** (the service worker) adds the script to open Chess.com tabs after an install, update or reload, and opens the engine page on demand.
- **The card** is `panel.html`, an extension page in an iframe, so its scripts and styles are separate from Chess.com's.
- **Stockfish runs in a hidden engine page** (`engine.html`, an offscreen document that `src/background.ts` opens on demand and closes when no card needs it). The card sits inside Chess.com's page, and there the browser may refuse to start workers ("The engine failed to load"); the engine page is the extension's own, so it can. The card sends it searches over a runtime port (`src/remoteEngine.ts`) and falls back to workers in the card if the engine page can't open. If neither starts, the card says why and offers the review on the website instead.
- **`src/panel.ts`** decodes the moves (Chess.com's compact TCN encoding, `src/lib/review/chesscomGame.ts`) into a PGN and runs **the website's own review** (`src/lib/review`): Stockfish 19 in Web Workers (`engine/`), the same labels, the same accuracy formula and the same opening book (`data/`), at the same default depth (Standard, 14; Fast and Thorough are one click away). Critical moments are searched deeper, as on the site.
- **The link** opens `/#review=<PGN>&as=<your colour>&depth=<depth>&data=<review>`. `data` is the finished review (every position's depth, evaluation and engine lines, packed and gzipped by `packReview` in `src/lib/review/share.ts`; about 4–8 KB for a whole game), so the site shows the review at once without running Stockfish. All of it is in the URL's fragment, which is never sent to a server.

Everything is bundled from this repository by `build.mjs` (esbuild), so the extension and the site always label moves the same way.

## Licence

GPL-3.0-or-later, like the site (it ships Stockfish). `engine/COPYING.txt` and `LICENSE` are included in the package.
