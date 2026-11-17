"""Accuracy by rating, for the /chess-accuracy page (src/data/accuracy-by-rating.json).

Reads the games Chess.com has reviewed (its public API gives both accuracies, both ratings,
the time class and the result) and writes, per time class and rating band, how accurate
players of that rating were: percentiles 5 to 95 of their game accuracy, and the medians in
games they won and lost. Only aggregates are written: no player, game or link.

    node scripts/eval/fetch-corpus.mjs scripts/eval/out/corpus.jsonl 2400
    python3 scripts/eval/accuracy-by-rating.py scripts/eval/out/corpus.jsonl scripts/eval/out/top-*.json

The same games as fit-performance.py (rated, 20 plies or more for the sampled ones; `load` is
the same), so the page and the performance rating read the same numbers.
"""
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "data", "accuracy-by-rating.json")


def load(paths):
    """The games fit-performance.py reads: (time class, white rating, black rating, white accuracy, black accuracy, white's score)."""
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


# Rating bands: under 400 together (few players stay there long), then 200 points each, then
# 2800 and above together. A band is shown only with enough of a time class's games.
EDGES = [0, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800]
MIN_GAMES = 150
CLASSES = ["rapid", "blitz", "bullet"]
PCTS = list(range(5, 100, 5))


def band_of(rating):
    for i in range(len(EDGES) - 1, -1, -1):
        if rating >= EDGES[i]:
            return i
    return 0


def pct(sorted_values, p):
    """Linear-interpolated percentile (p in 0–100) of an ascending list."""
    if not sorted_values:
        return None
    k = (len(sorted_values) - 1) * p / 100
    lo = int(k)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo)


def main(paths):
    games = load(paths)
    cells = {(tc, b): {"all": [], "won": [], "lost": []} for tc in CLASSES for b in range(len(EDGES))}
    counted = 0
    for tc, wr, br, aw, ab, score in games:
        if tc not in CLASSES:
            continue
        counted += 1
        for rating, acc, s in ((wr, aw, score), (br, ab, 1 - score)):
            c = cells[(tc, band_of(rating))]
            c["all"].append(acc)
            if s == 1:
                c["won"].append(acc)
            elif s == 0:
                c["lost"].append(acc)
    out = {"games": counted, "updated": datetime.date.today().isoformat(), "minGames": MIN_GAMES, "percentiles": PCTS, "classes": {}}
    for tc in CLASSES:
        rows = []
        for b in range(len(EDGES)):
            c = cells[(tc, b)]
            if len(c["all"]) < MIN_GAMES:
                continue
            a, w, l = sorted(c["all"]), sorted(c["won"]), sorted(c["lost"])
            rows.append(
                {
                    "from": EDGES[b],
                    "to": EDGES[b + 1] if b + 1 < len(EDGES) else None,
                    "n": len(a),
                    "p": [round(pct(a, p), 1) for p in PCTS],
                    "won": round(pct(w, 50), 1) if len(w) >= 30 else None,
                    "lost": round(pct(l, 50), 1) if len(l) >= 30 else None,
                }
            )
        out["classes"][tc] = rows
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"{counted} games -> {os.path.relpath(OUT)}")
    for tc in CLASSES:
        print(tc)
        for r in out["classes"][tc]:
            med = r["p"][PCTS.index(50)]
            print(f"  {r['from']:>4}-{r['to'] or '':<5} n={r['n']:>6} median {med:5.1f}  p25 {r['p'][PCTS.index(25)]:5.1f}  p75 {r['p'][PCTS.index(75)]:5.1f}  won {r['won']}  lost {r['lost']}")


if __name__ == "__main__":
    main(sys.argv[1:])
