"""Fit how an engine evaluation turns into an expected score, per rating band.

Reads the JSON lines from src/lib/eval/winprob-data.test.ts and fits, for each band of the two
players' average rating (evenly matched games: rating gap ≤ 150), the slope k of E(cp) = 1 / (1 + e^(-k·cp)) (Lichess's curve has
k = 0.00368208) by maximum likelihood on the game results (win 1, draw ½, loss 0).

    python3 scripts/eval/fit-winprob.py scripts/eval/out/winprob-*.jsonl
"""
import json
import math
import sys
from collections import defaultdict

LICHESS = 0.00368208
MAX_GAP = 150
BAND = 200


def load(paths):
    rows = []
    for p in paths:
        for line in open(p):
            r = json.loads(line)
            # Evenly matched games only: a big rating gap moves results whatever the evaluation.
            if "cp" in r and abs(r["cp"]) <= 1500 and abs(r["white"] - r["black"]) <= MAX_GAP:
                rows.append(r)
    return rows


def nll(k, rows):
    s = 0.0
    for r in rows:
        e = 1 / (1 + math.exp(-k * r["cp"]))
        e = min(max(e, 1e-9), 1 - 1e-9)
        s -= r["score"] * math.log(e) + (1 - r["score"]) * math.log(1 - e)
    return s / len(rows)


def fit(rows):
    lo, hi = 0.0005, 0.01
    for _ in range(60):  # golden-section search on a convex 1-D loss
        a = hi - (hi - lo) * 0.618
        b = lo + (hi - lo) * 0.618
        if nll(a, rows) < nll(b, rows):
            hi = b
        else:
            lo = a
    return (lo + hi) / 2


def winning_cp(k, e=0.93):
    """The evaluation at which the expected score reaches e."""
    return math.log(e / (1 - e)) / k


def main():
    rows = load(sys.argv[1:])
    bands = defaultdict(list)
    for r in rows:
        avg = (r["white"] + r["black"]) / 2
        bands[int(avg // BAND * BAND)].append(r)
    print(f"{len(rows)} positions (|cp| ≤ 1500, rating gap ≤ {MAX_GAP})")
    print(f"{'band':>11} {'positions':>9} {'k':>9} {'vs Lichess':>10} {'E=0.93 at':>10}")
    points = []
    for band in sorted(bands):
        rs = bands[band]
        if len(rs) < 300:
            continue
        k = fit(rs)
        points.append((band + BAND / 2, k, len(rs)))
        print(f"{band:>5}–{band + BAND - 1:<5} {len(rs):>9} {k:.5f} {k / LICHESS:>9.2f}× {winning_cp(k) / 100:>+9.2f}")
    k_all = fit(rows)
    print(f"{'all':>11} {len(rows):>9} {k_all:.5f} {k_all / LICHESS:>9.2f}× {winning_cp(k_all) / 100:>+9.2f}")
    # Weighted least squares of k against rating, for a rating-aware curve.
    w = sum(n for _, _, n in points)
    mx = sum(x * n for x, _, n in points) / w
    my = sum(y * n for _, y, n in points) / w
    sxx = sum(n * (x - mx) ** 2 for x, _, n in points)
    sxy = sum(n * (x - mx) * (y - my) for x, y, n in points)
    slope = sxy / sxx
    print(f"k(rating) ≈ {my:.5f} + {slope:.3e} · (rating − {mx:.0f})   →  k(1500) = {my + slope * (1500 - mx):.5f}, k(2700) = {my + slope * (2700 - mx):.5f}")


main()
