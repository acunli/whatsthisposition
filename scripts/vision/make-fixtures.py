"""Two test fixtures for the on-device reader, drawn with the GPL mpchess and cburnett pieces."""
import gzip, json, random, sys
sys.path.insert(0, ".")
import gen
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
sets = gen.load_sets(fonts=False)
CLS = gen.CLASSES

def grid_from_fen(fen, flipped):
    rows = []
    for r in fen.split()[0].split("/"):
        row = []
        for ch in r:
            row += [0] * int(ch) if ch.isdigit() else [CLS.index(ch)]
        rows.append(row)
    if flipped:
        rows = [list(reversed(r)) for r in reversed(rows)]
    return rows

cases = [
    ("ui_flipped", "r5k1/5ppp/p1pb4/1qp5/5P2/1PBP2Q1/P1P3PP/4R2K b - - 0 1", True, "mpchess", 56, True),
    ("plain_white", "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10", False, "cburnett", 44, False),
]
labels = []
for name, fen, flipped, pset, S, ui in cases:
    rng = random.Random(3)
    img, _ = gen.render_board(grid_from_fen(fen, flipped), sets, [], rng, size=S, set_name=pset)
    if ui:
        page = Image.new("RGB", (img.size[0] + 260, img.size[1] + 120), (30, 32, 36))
        page.paste(img, (20, 60))
        d = ImageDraw.Draw(page)
        f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
        d.text((20, 20), "player_one (1051)   2:04", fill=(230, 230, 230), font=f)
        for k in range(12):
            d.text((img.size[0] + 40, 70 + k * 28), f"{k + 1}. e4 e5 Nf3 Nc6", fill=(220, 220, 220), font=f)
        img = page
    rgba = img.convert("RGBA")
    open(f"{OUT}/{name}.rgba.gz", "wb").write(gzip.compress(rgba.tobytes(), 9))
    labels.append({"file": f"{name}.rgba.gz", "w": rgba.size[0], "h": rgba.size[1], "fen": fen, "flipped": flipped})
json.dump(labels, open(f"{OUT}/labels.json", "w"), indent=1)
print(labels)
