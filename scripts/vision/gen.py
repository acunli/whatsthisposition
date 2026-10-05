"""Synthetic chessboard renders for training the square classifier.

render_board() draws a full board (random theme, piece set, highlights, coordinates)
and returns the image plus the exact square size; squares() cuts it into 64 crops with
random misalignment, like an imperfect grid detection would.
"""
import io
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PIECES = ["P", "N", "B", "R", "Q", "K"]
CLASSES = ["."] + PIECES + [p.lower() for p in PIECES]  # 0 empty, 1-6 white, 7-12 black
FILE_OF = {"w": "w", "b": "b"}

# (light, dark) themes seen in the wild plus random ones
THEMES = [
    ("#eeeed2", "#769656"),  # chess.com green
    ("#f0d9b5", "#b58863"),  # lichess brown
    ("#dee3e6", "#8ca2ad"),  # lichess blue
    ("#efefef", "#8877b7"),  # chess.com purple
    ("#e8edf9", "#b7c0d8"),  # chess.com light blue
    ("#ebecd0", "#739552"),
    ("#f0f1f0", "#c4d8e4"),
    ("#ecdab9", "#ae8a68"),
    ("#e0e0e0", "#a0a0a0"),
    ("#ffffdd", "#86a666"),
    ("#d9e4e8", "#7b9fb0"),
    ("#e3c16f", "#b88b4a"),
    ("#f6f6f6", "#5c5c5c"),
    ("#cfd8dc", "#546e7a"),
    ("#eae6d6", "#5e8a6f"),  # ours
    ("#f2e6d6", "#c1a17d"),
    ("#ffffff", "#c0c0c0"),
    ("#e6f0e6", "#3c6e47"),
]
HIGHLIGHTS = [(247, 236, 90, 140), (186, 202, 68, 170), (155, 199, 0, 105), (20, 85, 30, 80), (99, 168, 255, 120), (255, 80, 80, 110), (240, 240, 80, 90), (110, 180, 230, 150)]


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def load_sets(exclude=(), fonts=True):
    sets = {k: v for k, v in font_sets().items() if k not in exclude} if fonts else {}
    root = os.path.join(HERE, "png")
    for name in sorted(os.listdir(root)):
        if name in exclude:
            continue
        d = os.path.join(root, name)
        imgs = {}
        for c in "wb":
            for p in PIECES:
                f = os.path.join(d, f"{c}{p}.png")
                if os.path.exists(f):
                    im = Image.open(f).convert("RGBA")
                    bbox = im.getbbox()
                    imgs[c + p] = (im, bbox)
        if len(imgs) == 12:
            sets[name] = imgs
    return sets


GLYPH_FILLED = {"K": "\u265a", "Q": "\u265b", "R": "\u265c", "B": "\u265d", "N": "\u265e", "P": "\u265f"}
GLYPH_HOLLOW = {"K": "\u2654", "Q": "\u2655", "R": "\u2656", "B": "\u2657", "N": "\u2658", "P": "\u2659"}
GLYPH_FONTS = [f for f in ["/System/Library/Fonts/Apple Symbols.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"] if os.path.exists(f)]


def _glyph(ch, font, fill, stroke=None, sw=0):
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((128, 128), ch, font=font, fill=fill, anchor="mm", stroke_width=sw, stroke_fill=stroke)
    x0, y0, x1, y1 = im.getbbox()
    piece = im.crop((x0, y0, x1, y1))
    k = 108 / max(x1 - x0, y1 - y0)
    piece = piece.resize((max(1, int((x1 - x0) * k)), max(1, int((y1 - y0) * k))), Image.LANCZOS)
    out = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    out.paste(piece, ((128 - piece.size[0]) // 2, (128 - piece.size[1]) // 2 + 4), piece)
    return out


def font_sets():
    """Unicode chess glyphs from system fonts: filled-with-outline and hollow 'diagram' styles."""
    out = {}
    for fi, path in enumerate(GLYPH_FONTS):
        font = ImageFont.truetype(path, 180)
        filled, hollow = {}, {}
        for p in PIECES:
            filled["w" + p] = _glyph(GLYPH_FILLED[p], font, (255, 255, 255, 255), (0, 0, 0, 255), 4)
            filled["b" + p] = _glyph(GLYPH_FILLED[p], font, (0, 0, 0, 255))
            hollow["w" + p] = _glyph(GLYPH_HOLLOW[p], font, (0, 0, 0, 255))
            hollow["b" + p] = _glyph(GLYPH_FILLED[p], font, (0, 0, 0, 255))
        for name, d in (("glyph-filled", filled), ("glyph-hollow", hollow)):
            out[f"{name}-{fi}"] = {k: (v, v.getbbox()) for k, v in d.items()}
    return out


def transform_piece(im, rng, style):
    """Per-board piece restyling: tint, stroke weight, drop shadow."""
    if style.get("tint"):
        light, dark = style["tint"]
        rgb = im.convert("RGB")
        from PIL import ImageOps

        g = ImageOps.grayscale(rgb)
        col = ImageOps.colorize(g, black=dark, white=light)
        col.putalpha(im.getchannel("A"))
        im = col
    if style.get("stroke"):
        a = im.getchannel("A")
        a = a.filter(ImageFilter.MaxFilter(3)) if style["stroke"] > 0 else a.filter(ImageFilter.MinFilter(3))
        base = Image.new("RGBA", im.size, (0, 0, 0, 0))
        dark = Image.new("RGBA", im.size, (20, 20, 20, 255))
        base.paste(dark, (0, 0), a)
        im = Image.alpha_composite(base, im)
    if style.get("shadow"):
        a = im.getchannel("A").filter(ImageFilter.GaussianBlur(4))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.paste(Image.new("RGBA", im.size, (0, 0, 0, 110)), (4, 6), a)
        im = Image.alpha_composite(sh, im)
    return im


def load_textures():
    root = os.path.join(HERE, "boards")
    return [Image.open(os.path.join(root, f)).convert("RGB") for f in sorted(os.listdir(root))]


FONTS = [f for f in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Verdana.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf"] if os.path.exists(f)]


def random_grid(rng):
    """8x8 of class indices; pieces sampled uniformly over the 12 classes so kings/queens are common enough."""
    grid = [[0] * 8 for _ in range(8)]
    n = rng.randint(4, 40)
    cells = rng.sample(range(64), n)
    for k in cells:
        grid[k // 8][k % 8] = rng.randint(1, 12)
    return grid


def jitter_color(rgb, rng, amount=18):
    return tuple(max(0, min(255, c + rng.randint(-amount, amount))) for c in rgb)


def render_board(grid, sets, textures, rng, size=None, set_name=None):
    S = size or rng.randint(22, 110)
    W = S * 8
    # board
    if textures and rng.random() < 0.25:
        tex = rng.choice(textures).resize((W, W), Image.BILINEAR)
        board = tex.copy()
    else:
        if rng.random() < 0.75:
            light, dark = (hex2rgb(x) for x in rng.choice(THEMES))
            light, dark = jitter_color(light, rng, 10), jitter_color(dark, rng, 10)
        else:
            light = tuple(rng.randint(150, 255) for _ in range(3))
            dark = tuple(max(0, c - rng.randint(40, 140)) for c in light)
            if rng.random() < 0.5:
                dark = tuple(rng.randint(40, 200) for _ in range(3))
        board = Image.new("RGB", (W, W), light)
        dr = ImageDraw.Draw(board)
        hatch = rng.random() < 0.08
        for r in range(8):
            for c in range(8):
                if (r + c) % 2 == 1:
                    if hatch:  # newspaper-style diagonal hatching for dark squares
                        gap = max(3, S // rng.randint(6, 10))
                        for k in range(-S, S, gap):
                            dr.line([c * S + k, r * S + S, c * S + k + S, r * S], fill=dark, width=max(1, gap // 3))
                    else:
                        dr.rectangle([c * S, r * S, (c + 1) * S - 1, (r + 1) * S - 1], fill=dark)
        if hatch:  # re-clip hatching that spilled into light squares
            clean = Image.new("RGB", (W, W), light)
            mask = Image.new("L", (W, W), 0)
            md = ImageDraw.Draw(mask)
            for r in range(8):
                for c in range(8):
                    if (r + c) % 2 == 1:
                        md.rectangle([c * S, r * S, (c + 1) * S - 1, (r + 1) * S - 1], fill=255)
            clean.paste(board, (0, 0), mask)
            board = clean
    board = board.convert("RGBA")
    # highlights (last move, check, selection)
    over = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    od = ImageDraw.Draw(over)
    for _ in range(rng.choice([0, 0, 1, 2, 2, 3])):
        r, c = rng.randrange(8), rng.randrange(8)
        col = rng.choice(HIGHLIGHTS)
        if rng.random() < 0.15:  # radial-ish check highlight
            for k in range(6, 0, -1):
                a = int(col[3] * (7 - k) / 6)
                pad = int(S * (0.5 - k / 12))
                od.ellipse([c * S + pad, r * S + pad, (c + 1) * S - pad, (r + 1) * S - pad], fill=col[:3] + (a,))
        elif rng.random() < 0.15:  # selection border
            w = max(2, S // 16)
            od.rectangle([c * S, r * S, (c + 1) * S - 1, (r + 1) * S - 1], outline=col[:3] + (220,), width=w)
        else:
            od.rectangle([c * S, r * S, (c + 1) * S - 1, (r + 1) * S - 1], fill=col)
    board = Image.alpha_composite(board, over)
    # pieces
    set_name = set_name or rng.choice(list(sets))
    pset = sets[set_name]
    scale = rng.uniform(0.7, 1.08)
    aspect = rng.uniform(0.92, 1.08)
    style = {}
    if rng.random() < 0.35:
        # separate tints per colour; "black" pieces can be mid-tone (blue, brown, grey), like many app sets
        style["tint_w"] = (tuple(rng.randint(185, 255) for _ in range(3)), tuple(rng.randint(0, 80) for _ in range(3)))
        style["tint_b"] = (tuple(rng.randint(120, 220) for _ in range(3)), tuple(rng.randint(10, 140) for _ in range(3)))
    if rng.random() < 0.15:
        style["stroke"] = rng.choice([-1, 1])
    if rng.random() < 0.15:
        style["shadow"] = True
    cache = {}
    for r in range(8):
        for c in range(8):
            k = grid[r][c]
            if not k:
                continue
            ch = CLASSES[k]
            key = ("w" if ch.isupper() else "b") + ch.upper()
            if key not in cache:
                im, _ = pset[key]
                if style:
                    st = dict(style)
                    if "tint_w" in st:
                        st["tint"] = st["tint_w"] if key[0] == "w" else st["tint_b"]
                    im = transform_piece(im, rng, st)
                pw = max(8, int(S * scale * aspect))
                ph = max(8, int(S * scale / aspect))
                cache[key] = im.resize((pw, ph), Image.LANCZOS)
            pim = cache[key]
            pw, ph = pim.size
            ox = c * S + (S - pw) // 2 + rng.randint(-max(1, S // 30), max(1, S // 30))
            oy = r * S + (S - ph) // 2 + rng.randint(-max(1, S // 30), max(1, S // 30))
            board.alpha_composite(pim, (max(0, ox), max(0, oy)))
    # legal-move dots / capture rings
    if rng.random() < 0.15:
        od2 = ImageDraw.Draw(board)
        for _ in range(rng.randint(1, 6)):
            r, c = rng.randrange(8), rng.randrange(8)
            cx, cy = c * S + S // 2, r * S + S // 2
            if grid[r][c] == 0:
                rad = S * rng.uniform(0.12, 0.18)
                od2.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(20, 85, 30, 90))
            else:
                rad = S * 0.47
                od2.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(20, 85, 30, 120), width=max(2, S // 12))
    # coordinates
    if FONTS and rng.random() < 0.45:
      try:
        dr = ImageDraw.Draw(board)
        try:
            font = ImageFont.truetype(rng.choice(FONTS), max(7, int(S * rng.uniform(0.16, 0.26))))
        except OSError:
            font = ImageFont.load_default()
        files = "abcdefgh" if rng.random() < 0.5 else "hgfedcba"
        ranks = "87654321" if files[0] == "a" else "12345678"
        style = rng.random()
        for i in range(8):
            fc = (120, 120, 120, 255) if rng.random() < 0.2 else ((60, 60, 60, 255) if i % 2 == 0 else (230, 230, 230, 255))
            # file letter in the bottom row, rank digit in the left column (chess.com style) or opposite corners
            if style < 0.5:
                dr.text((i * S + S - S * 0.2, 7 * S + S * 0.72), files[i], fill=fc, font=font, anchor="mm")
                dr.text((S * 0.12, i * S + S * 0.16), ranks[i], fill=fc, font=font, anchor="mm")
            else:
                dr.text((i * S + S * 0.14, 7 * S + S * 0.8), files[i], fill=fc, font=font, anchor="mm")
                dr.text((7 * S + S * 0.86, i * S + S * 0.16), ranks[i], fill=fc, font=font, anchor="mm")
      except (OSError, ZeroDivisionError):
        pass
    img = board.convert("RGB")
    return img, S


def degrade(img, rng):
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    if rng.random() < 0.25:  # down/up-sampling
        w, h = img.size
        f = rng.uniform(0.45, 0.9)
        img = img.resize((max(16, int(w * f)), max(16, int(h * f))), Image.BILINEAR).resize((w, h), Image.BILINEAR)
    if rng.random() < 0.5:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=rng.randint(25, 92))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    arr = np.asarray(img).astype(np.float32)
    if rng.random() < 0.5:
        arr = arr * rng.uniform(0.75, 1.2) + rng.uniform(-25, 25)
    if rng.random() < 0.3:
        arr = arr + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 8), arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


RESAMPLE = [Image.BILINEAR, Image.BOX, Image.LANCZOS, Image.BICUBIC]


def squares(img, S, rng, out=32, jitter=0.08):
    crops = []
    for r in range(8):
        for c in range(8):
            j = jitter * S
            x0 = c * S + rng.uniform(-j, j)
            y0 = r * S + rng.uniform(-j, j)
            sz = S * (1 + rng.uniform(-jitter, jitter))
            box = (x0, y0, x0 + sz, y0 + sz)
            crops.append(np.asarray(img.crop(box).resize((out, out), rng.choice(RESAMPLE))))
    return crops


def make(n_boards, seed, exclude=(), out=32):
    rng = random.Random(seed)
    np.random.seed(seed % (1 << 31))
    sets = load_sets(exclude)
    tex = load_textures()
    X, y = [], []
    for _ in range(n_boards):
        g = random_grid(rng)
        img, S = render_board(g, sets, tex, rng)
        img = degrade(img, rng)
        for k, crop in enumerate(squares(img, S, rng, out)):
            X.append(crop)
            y.append(g[k // 8][k % 8])
    return np.stack(X), np.array(y, dtype=np.int64)


if __name__ == "__main__":
    import sys

    rng = random.Random(1)
    sets = load_sets()
    tex = load_textures()
    os.makedirs(os.path.join(HERE, "samples"), exist_ok=True)
    for i in range(int(sys.argv[1]) if len(sys.argv) > 1 else 6):
        img, S = render_board(random_grid(rng), sets, tex, rng)
        degrade(img, rng).save(os.path.join(HERE, "samples", f"board{i}.png"))
    print(len(sets), "sets")
