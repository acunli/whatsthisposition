"""Fit the performance rating shown in the game review (src/lib/review/performance.ts).

Chess.com describes its own number as "comparing the quality of your moves to what is
expected from a player at your rating level", and says it averages out to the player's
rating over time. This fits the same idea on games Chess.com has reviewed (its public API
gives both accuracies, both ratings, the time class and the result):

  1. the expected accuracy at each rating, per time class: two straight pieces joined at a
     knee, by least squares (EXPECTED in performance.ts);
  2. for a range of weights w in performance = rating + w * (level - rating), where `level`
     is the rating whose expected accuracy equals this game's: how well the gap between the
     two players' performances predicts the result when read as a rating gap, and how far
     performances spread around the rating (pass --weight=0.35 to see one weight's spread).

    node scripts/eval/fetch-corpus.mjs scripts/eval/out/corpus.jsonl 2400
    python3 scripts/eval/fit-performance.py scripts/eval/out/corpus.jsonl [scripts/eval/out/top-*.json]
"""
import json
import math
import sys
from collections import defaultdict

LO, HI = 0, 3600
SHOWN = (100, 3300)


def load(paths):
    games = []
    seen = set()
    for p in paths:
        if p.endswith(".jsonl"):
            for line in open(p):
                r = json.loads(line)
                if r["rated"] and r["plies"] >= 20 and r["url"] not in seen:
                    seen.add(r["url"])
                    games.append((r["tc"], r["w"], r["b"], r["aw"], r["ab"], r["score"]))
        else:
            for g in json.load(open(p)):
                a = g.get("accuracies") or {}
                if g.get("rules") != "chess" or not g.get("rated") or a.get("white") is None or a.get("black") is None or g["url"] in seen:
                    continue
                seen.add(g["url"])
                s = 1 if g["white"]["result"] == "win" else 0 if g["black"]["result"] == "win" else 0.5
                games.append((g["time_class"], g["white"]["rating"], g["black"]["rating"], a["white"], a["black"], s))
    return games


def solve3(m, v):
    """Solves a 3x3 linear system by Gaussian elimination."""
    m = [row[:] + [v[i]] for i, row in enumerate(m)]
    for i in range(3):
        piv = max(range(i, 3), key=lambda r: abs(m[r][i]))
        m[i], m[piv] = m[piv], m[i]
        for r in range(i + 1, 3):
            f = m[r][i] / m[i][i]
            for c in range(i, 4):
                m[r][c] -= f * m[i][c]
    x = [0.0] * 3
    for i in (2, 1, 0):
        x[i] = (m[i][3] - sum(m[i][c] * x[c] for c in range(i + 1, 3))) / m[i][i]
    return x


def hinge(players):
    """accuracy = base + below*min(r, knee) + above*max(0, r - knee), least squares over every knee."""
    best = None
    for knee in range(500, 1500, 50):
        xtx = [[0.0] * 3 for _ in range(3)]
        xty = [0.0] * 3
        for r, a in players:
            x = (1.0, min(r, knee), max(0, r - knee))
            for i in range(3):
                xty[i] += x[i] * a
                for j in range(3):
                    xtx[i][j] += x[i] * x[j]
        base, below, above = solve3(xtx, xty)
        sse = sum((base + below * min(r, knee) + above * max(0, r - knee) - a) ** 2 for r, a in players)
        if best is None or sse < best[0]:
            best = (sse, knee, base, below, above)
    return best[1:]


def expected(c, r):
    knee, base, below, above = c
    return base + below * min(r, knee) + above * max(0, r - knee)


def level(c, a):
    """The rating whose expected accuracy is `a` (the curve read backwards), within LO..HI."""
    knee, base, below, above = c
    at_knee = base + below * knee
    return min(HI, max(LO, (a - base) / below if a <= at_knee else knee + (a - at_knee) / above))


def main():
    games = load(sys.argv[1:])
    print(f"{len(games)} rated games with both accuracies")
    classes = ["rapid", "blitz", "bullet"]
    curves = {}
    for tc in classes:
        players = [(w, aw) for t, w, b, aw, ab, s in games if t == tc and w >= 150] + [(b, ab) for t, w, b, aw, ab, s in games if t == tc and b >= 150]
        curves[tc] = hinge(players)
        knee, base, below, above = curves[tc]
        print(f"\n{tc}: {len(players)} player-games  knee {knee}, base {base:.2f}, below {below:.5f}, above {above:.5f}")
        print("  expected at " + ", ".join(f"{r}: {expected(curves[tc], r):.1f}" for r in (400, 800, 1200, 1600, 2000, 2400, 2800, 3200)))
    daily = [(w, aw) for t, w, b, aw, ab, s in games if t == "daily"] + [(b, ab) for t, w, b, aw, ab, s in games if t == "daily"]
    if daily:
        print(f"\ndaily: {len(daily)} player-games, accuracy above rapid's curve by {sum(a - expected(curves['rapid'], r) for r, a in daily) / len(daily):.2f}")

    def perf(tc, r, a, w):
        return min(SHOWN[1], max(SHOWN[0], r + w * (level(curves[tc], a) - r)))

    # The weight: how well does the performance gap predict the result, read as a rating gap?
    rows = [g for g in games if g[0] in curves]
    print("\nweight  log-loss of the result on the Elo curve")
    for i in range(20, 75, 5):
        w = i / 100
        nll = 0.0
        for tc, rw, rb, aw, ab, s in rows:
            d = perf(tc, rw, aw, w) - perf(tc, rb, ab, w)
            e = min(max(1 / (1 + 10 ** (-d / 400)), 1e-6), 1 - 1e-6)
            nll -= s * math.log(e) + (1 - s) * math.log(1 - e)
        print(f"  {w:.2f}    {nll / len(rows):.4f}")

    # What a weight gives: the spread of performance minus rating, by rating band.
    w = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--weight=")), 0.35))
    for tc in classes:
        print(f"\n{tc}, weight {w}: performance minus rating")
        by = defaultdict(list)
        for t, rw, rb, aw, ab, s in rows:
            if t != tc:
                continue
            by[int(round(rw / 400)) * 400].append(perf(tc, rw, aw, w) - rw)
            by[int(round(rb / 400)) * 400].append(perf(tc, rb, ab, w) - rb)
        for k in sorted(by):
            v = sorted(by[k])
            if len(v) < 100:
                continue
            q = lambda p: v[int(p * (len(v) - 1))]
            print(f"  {k:4d}: n={len(v):5d} median={q(0.5):+5.0f} mean={sum(v) / len(v):+5.0f}  5%={q(0.05):+5.0f} 25%={q(0.25):+5.0f} 75%={q(0.75):+5.0f} 95%={q(0.95):+5.0f}")


main()
