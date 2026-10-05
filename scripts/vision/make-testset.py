"""Builds a held-out test set of board images with known positions taken from real games:
Chess.com renders (piece sets never used in training), Lichess exports, and composites
that put a board inside a fake app screenshot (player bars, clocks, side panel).

  python make-testset.py games.json out_dir     # games.json: a Chess.com PubAPI "games" list

The images are only used locally to measure accuracy; they are not committed.
"""
import io, json, os, random, subprocess, sys, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont

R = random.Random(7)
games = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def fens_of(pgn):
    # replay with node chess.js for exact FENs
    out = subprocess.run(["node", "-e", """
const {Chess}=require(process.argv[1]);
const c=new Chess(); c.loadPgn(require('fs').readFileSync(0,'utf8'));
const h=c.history(); const g=new Chess(); const out=[];
for(const m of h){g.move(m); out.push(g.fen());}
console.log(JSON.stringify(out));""", os.path.join(ROOT, "node_modules", "chess.js")], input=pgn, capture_output=True, text=True)
    return json.loads(out.stdout)

CC_PIECES = ["neo", "classic", "wood", "glass", "gothic", "game_room", "alpha", "bases", "book", "club", "condal", "icy_sea", "light", "maya", "metal", "modern", "nature", "ocean", "sky", "tournament", "vintage", "8_bit", "neo_wood", "dash", "newspaper", "marble", "graffiti", "tigers", "cases", "lolz"]
CC_BOARDS = ["green", "brown", "blue", "purple", "dark_wood", "icy_sea", "marble", "metal", "tournament", "walnut", "bases", "glass", "light", "sky", "sand", "stone", "orange", "red", "burled_wood", "parchment", "newspaper", "dash", "graffiti", "tan", "8_bit"]
LI_THEMES = ["blue", "brown", "green", "ic", "pink", "purple"]
LI_PIECES = ["cburnett", "merida", "alpha", "pirouetti", "chessnut", "chess7", "reillycraig", "companion", "riohacha", "kosal", "leipzig", "fantasy", "spatial", "california", "pixel", "maestro", "fresca", "cardinal", "gioco", "tatiana", "staunty", "governor", "dubrovny", "icpieces", "shapes", "letter"]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read()

def ui_composite(board, rng):
    """Put a board inside a fake app screenshot: dark/light page, player bars with text, side panel."""
    bw = board.size[0]
    dark = rng.random() < 0.7
    bg = (rng.randint(20, 50),) * 3 if dark else (rng.randint(225, 245),) * 3
    pad_l, pad_r = rng.randint(0, 120), rng.randint(0, 420)
    bar = rng.randint(30, 70)
    W, H = pad_l + bw + pad_r, bw + 2 * bar + rng.randint(0, 60)
    page = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(page)
    fnt = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", max(12, bar // 3))
    fg = (230, 230, 230) if dark else (30, 30, 30)
    top = bar + rng.randint(0, 20)
    page.paste(board, (pad_l, top))
    d.rectangle([pad_l, 4, pad_l + bar - 8, bar - 4], fill=(120, 90, 60))
    d.text((pad_l + bar, bar // 3), "opponent_123 (1051)", fill=fg, font=fnt)
    d.rectangle([pad_l + bw - 110, 6, pad_l + bw, bar - 6], fill=(60, 60, 60) if dark else (200, 200, 200))
    d.text((pad_l + bw - 80, bar // 3), "2:04", fill=fg, font=fnt)
    y2 = top + bw + 6
    d.text((pad_l + bar, y2 + bar // 4), "Ay7u (1027)", fill=fg, font=fnt)
    if pad_r > 200:
        x = pad_l + bw + 20
        d.rectangle([x, top, W - 10, top + bw], fill=(35, 35, 40) if dark else (250, 250, 250))
        for k in range(12):
            d.text((x + 10, top + 10 + k * 28), f"{k+1}. e4 e5  Nf3 Nc6", fill=fg, font=fnt)
    return page

items = []
picked = []
for g in R.sample(games, 60):
    fens = fens_of(g["pgn"])
    if len(fens) < 8: continue
    picked.append(R.choice(fens[5:]))
for i, fen in enumerate(picked):
    flip = R.random() < 0.4
    q = urllib.parse.quote(fen)
    try:
        if i % 3 != 2:
            piece, board = R.choice(CC_PIECES), R.choice(CC_BOARDS)
            data = get(f"https://www.chess.com/dynboard?fen={q}&board={board}&piece={piece}&size={R.choice([1,2,3])}" + ("&flip=true" if flip else ""))
            src = f"chesscom/{piece}/{board}"
        else:
            theme, piece = R.choice(LI_THEMES), R.choice(LI_PIECES)
            data = get(f"https://lichess1.org/export/fen.gif?fen={q}&theme={theme}&piece={piece}&color={'black' if flip else 'white'}")
            src = f"lichess/{piece}/{theme}"
    except Exception as e:
        print("skip", e); continue
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if R.random() < 0.5:
        im = ui_composite(im, R); src += "+ui"
    if R.random() < 0.4:
        b = io.BytesIO(); im.save(b, "JPEG", quality=R.randint(55, 90)); im = Image.open(io.BytesIO(b.getvalue())).convert("RGB"); src += "+jpg"
    name = f"t{i:02d}.png"
    im.save(f"{OUT}/{name}")
    open(f"{OUT}/{name}.rgba", "wb").write(im.convert("RGBA").tobytes())
    items.append({"file": name, "fen": fen, "flipped": flip, "source": src, "w": im.size[0], "h": im.size[1]})
json.dump(items, open(f"{OUT}/labels.json", "w"), indent=1)
print(len(items), "test images")
