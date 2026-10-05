#!/usr/bin/env python3
"""Compares our game accuracy with Chess.com's and re-fits the calibration.

  python3 scripts/eval/fit-accuracy.py scripts/eval/out/accuracy-data.json

Prints the error of what the app shows today, then, for a few per-move decay
values, a linear map fitted on one half of the games and tested on the other
(and the reverse), plus the fit on all games. The shipped constants live in
src/lib/review/accuracy.ts (ACCURACY_DECAY, ACCURACY_SCALE). Standard library only.
"""
import json
import math
import statistics as st
import sys

K = 0.00368208  # Lichess win% curve, the same one the move labels use


def cp_of(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p)) / K


def win(cp):
    return 100 / (1 + math.exp(-K * cp))


def move_acc(wb, wa, a):
    return max(0, min(100, 103.1668 * math.exp(-a * max(0, wb - wa)) - 3.1669))


def pairs(rows, a):
    out = []
    for r in rows:
        for c, key in (("w", "white"), ("b", "black")):
            accs = [move_acc(win(cp_of(m["before"])), win(cp_of(m["after"])), a) for m in r["moves"] if m["c"] == c and m["cls"] != "forced"]
            if accs and r["cc"].get(key) is not None:
                out.append((st.mean(accs), r["cc"][key]))
    return out


def linfit(ps):
    xs = [p[0] for p in ps]
    ys = [p[1] for p in ps]
    mx, my = st.mean(xs), st.mean(ys)
    b = sum((x - mx) * (y - my) for x, y in ps) / sum((x - mx) ** 2 for x in xs)
    return b, my - b * mx


def mae(ps, b, c):
    return st.mean(abs(max(0, min(100, b * x + c)) - y) for x, y in ps)


def corr(ps):
    xs = [p[0] for p in ps]
    ys = [p[1] for p in ps]
    mx, my = st.mean(xs), st.mean(ys)
    return sum((x - mx) * (y - my) for x, y in ps) / len(ps) / (st.pstdev(xs) * st.pstdev(ys))


rows = json.load(open(sys.argv[1]))
shown = [(r["ours"][c], r["cc"][k]) for r in rows for c, k in (("w", "white"), ("b", "black")) if r["ours"][c] is not None and r["cc"].get(k) is not None]
print(f"{len(rows)} games, {len(shown)} player scores")
print(f"what the app shows now: mean error {st.mean(abs(x - y) for x, y in shown):.2f}, correlation {corr(shown):.3f}")
half = len(rows) // 2
for a in (0.04354, 0.055, 0.07, 0.09):
    tr, te = pairs(rows[:half], a), pairs(rows[half:], a)
    b1, c1 = linfit(tr)
    b2, c2 = linfit(te)
    bf, cf = linfit(pairs(rows, a))
    print(f"decay {a:.3f}: held-out error {mae(te, b1, c1):.2f} / {mae(tr, b2, c2):.2f}, all games: {bf:.3f}·x {cf:+.1f} (corr {corr(pairs(rows, a)):.3f})")
