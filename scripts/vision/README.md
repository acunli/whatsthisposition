# On-device board reading: training and evaluation

The photo reader runs entirely in the browser (`src/lib/vision/local/`). Nothing is uploaded unless the player chooses the optional AI reader.

1. **Find the board** (`detect.ts`). Square boundaries are the only long edges that switch direction along their length. Every spacing and offset is searched for an evenly spaced comb of 7 lines, at three image scales; textures such as hatching average out at the coarse scales. Candidates are then scored by two things:
   - how many of the 49 inner points are true X-corners, where four squares meet and diagonal neighbours match;
   - whether the cells alternate light and dark.

   X-corners are what separate a board from move-list text or wood grain.
2. **Read the squares** (`net.ts`). A small CNN takes each 32×32 square as input: three conv blocks, about 217k parameters, stored in float16. Two copies trained with different seeds are averaged. Inference is plain TypeScript, at about 8M multiply-adds per square. Plainly empty squares skip the network.
3. **Clean up** (`recognize.ts`).
   - Squares that look identical vote together.
   - There is exactly one king per side; extra kings are re-read and a missing one is filled in from the likeliest square.
   - No pawns are allowed on the edge rows.
   - The orientation is guessed from where pawns and kings stand.
   - Every square under 80% confidence is marked "?" for the player to check.

## Training data

All synthetic, generated on the fly by `gen.py`:

- **Pieces:**
  - the 38 [Lichess piece sets](https://github.com/lichess-org/lila/tree/master/public/piece) (their own open licences, downloaded at training time, not committed);
  - Unicode chess glyphs from system fonts, in filled and hollow diagram styles.
- **Boards:**
  - Lichess board textures;
  - 18 app colour themes plus random colours;
  - hatched "newspaper" squares.
- **Augmentation:**
  - last-move, check and selection highlights, move-hint dots, coordinates;
  - piece scale and aspect jitter;
  - per-colour tints (including mid-tone "black" pieces), stroke weight, shadows;
  - blur, resampling, JPEG artefacts, brightness, noise;
  - crops misaligned by up to 8%, as an imperfect grid would produce.

No Chess.com assets are used for training.

## Retraining

```bash
cd scripts/vision
bash fetch-assets.sh                          # Lichess piece sets and boards
npx -y -p playwright node rasterize.mjs       # SVG pieces → 128 px PNGs (needs Chromium)
python3 -m venv venv && ./venv/bin/pip install torch numpy pillow
./venv/bin/python train.py --steps 16000 --seed 1 --out a.bin
./venv/bin/python train.py --steps 16000 --seed 2 --out b.bin
cp a.bin ../../public/models/squares-a.bin && cp b.bin ../../public/models/squares-b.bin
./venv/bin/python make-fixtures.py ../../src/lib/vision/local/fixtures   # test fixtures (mpchess, cburnett)
```

Training one model takes about 25 minutes on an Apple M3 (MPS).

## Evaluation

`make-testset.py games.json out/` builds a held-out set from real positions in a Chess.com games list (the PubAPI's monthly archive format). For each position it uses one of three sources:

- Chess.com's board-image service, with 30 piece sets and 25 boards, none of them seen in training;
- Lichess's GIF export;
- either of the above placed inside a fake app screenshot with player bars, clocks and a move list, sometimes JPEG-compressed.

Then:

```bash
VISION_BENCH_DIR=out npx vitest run src/lib/vision/local/bench.test.ts   # writes out/results.txt
```

Results on 61 images from positions in Ay7u's games, plus the owner's own Chess.com screenshot (2026-10-05):

| Reader | Squares right | Boards exactly right | Orientation right |
| --- | --- | --- | --- |
| Previous cloud reader (Qwen models via SoCLaaS, the owner's screenshot) | 62–75% | 0/1 | n/a |
| On-device, one model | 98.4% | 52/61 | 59/61 |
| **On-device, shipped pair** | **98.5%** | **53/61** | **59/61** |

Excluding the two abstract Lichess sets (letters and geometric shapes), 99.4% of squares are right. The remaining errors are style-specific:

- the knights of Chess.com's "Tournament" and "Club" sets read as rooks;
- the "Condal" bishops read as knights;
- the 8-bit set.

The owner's screenshot (Chess.com purple board, flipped, with the app UI around it) is read exactly. Reading takes about 1.4 s in Node, and similar in a browser.
