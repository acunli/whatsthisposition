"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCURACY_CLASSES, CLASS_NAME, at, bandFor, bandLabel, bandsOf, medianOf, percentileIn, type AccuracyClass, type RatingBand } from "@/lib/accuracy/byRating";
import { onePerformance } from "@/lib/review/performance";

const one = (x: number) => x.toFixed(1);

/** A rating band, or a gap where the data has too few games (the line breaks there). */
type Slot = { band: RatingBand } | { gap: true };

function slotsOf(tc: AccuracyClass): Slot[] {
  const out: Slot[] = [];
  let prev: RatingBand | null = null;
  for (const b of bandsOf(tc)) {
    if (prev && prev.to !== b.from) out.push({ gap: true });
    out.push({ band: b });
    prev = b;
  }
  return out;
}

const shortLabel = (b: RatingBand) => (b.to === null ? `${b.from}+` : b.from === 0 ? `<${b.to}` : String(b.from));

const Y_MIN = 30;
const Y_MAX = 100;
const Y_TICKS = [30, 40, 50, 60, 70, 80, 90, 100];
const PAD = { left: 36, right: 12, top: 14, bottom: 30 };
const HEIGHT = 300;

/**
 * How a game's accuracy compares with players of the same rating: the calculator, then the
 * chart of the time class (median, middle half and 10–90% of games per rating band), with the
 * player's game marked on it.
 */
export function AccuracyTool() {
  const [tc, setTc] = useState<AccuracyClass>("rapid");
  const [ratingText, setRatingText] = useState("");
  const [accText, setAccText] = useState("");
  const rating = Number(ratingText);
  const accuracy = Number(accText);
  const hasRating = ratingText.trim() !== "" && Number.isFinite(rating) && rating >= 100 && rating <= 3500;
  const hasAcc = accText.trim() !== "" && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100;
  const band = hasRating ? bandFor(tc, rating) : null;

  let result: ReactNode = <>Enter your rating and a game&apos;s accuracy to see how the game compares.</>;
  if (hasRating && !band) result = <>Too few {tc} games at that rating in this data to compare with.</>;
  else if (band && !hasAcc)
    result = (
      <>
        {CLASS_NAME[tc]} players rated {bandLabel(band)} reach a median accuracy of <b>{one(medianOf(band))}</b>; half of their games fall between {one(at(band, 25))} and{" "}
        {one(at(band, 75))}.
      </>
    );
  else if (band && hasAcc) {
    const { pct, edge } = percentileIn(band, accuracy);
    const perf = onePerformance(rating, accuracy, tc);
    result = (
      <>
        {edge === "above" ? (
          <>
            Better than <b>95%</b> of
          </>
        ) : edge === "below" ? (
          <>
            Below <b>95%</b> of
          </>
        ) : (
          <>
            Better than <b>{pct}%</b> of
          </>
        )}{" "}
        {tc} games by players rated {bandLabel(band)} (their median is {one(medianOf(band))}). A performance rating of about <b>{perf}</b>: the rating this game was played like.
      </>
    );
  }

  return (
    <section className="acc-tool" aria-label="Accuracy calculator">
      <div className="tabs acc-tabs" role="tablist" aria-label="Time control">
        {ACCURACY_CLASSES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={tc === c} className={tc === c ? "tab tab-on" : "tab"} onClick={() => setTc(c)}>
            {CLASS_NAME[c]}
          </button>
        ))}
      </div>
      <div className="acc-fields">
        <label className="acc-field">
          <span>Your rating</span>
          <input className="input" inputMode="numeric" type="number" min={100} max={3500} placeholder="1200" value={ratingText} onChange={(e) => setRatingText(e.target.value)} />
        </label>
        <label className="acc-field">
          <span>A game&apos;s accuracy</span>
          <input className="input" inputMode="decimal" type="number" min={0} max={100} step={0.1} placeholder="78.4" value={accText} onChange={(e) => setAccText(e.target.value)} />
        </label>
      </div>
      <p className="acc-result" aria-live="polite">
        {result}
      </p>
      <AccuracyChart tc={tc} you={band && hasAcc ? { rating, accuracy } : null} />
    </section>
  );
}

function AccuracyChart({ tc, you }: { tc: AccuracyClass; you: { rating: number; accuracy: number } | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slots = useMemo(() => slotsOf(tc), [tc]);
  const plotW = width - PAD.left - PAD.right;
  const slotW = plotW / slots.length;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + slotW * (i + 0.5);
  const y = (a: number) => PAD.top + plotH * (1 - (Math.min(Y_MAX, Math.max(Y_MIN, a)) - Y_MIN) / (Y_MAX - Y_MIN));
  const everyOther = slotW < 40;

  // Runs of neighbouring bands, each drawn as its own line and washes.
  const runs: { i: number; b: RatingBand }[][] = [];
  slots.forEach((s, i) => {
    if ("gap" in s) runs.push([]);
    else {
      if (!runs.length) runs.push([]);
      runs[runs.length - 1].push({ i, b: s.band });
    }
  });
  const area = (run: { i: number; b: RatingBand }[], lo: number, hi: number) =>
    run.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(at(p.b, hi))}`).join("") +
    [...run]
      .reverse()
      .map((p) => `L${x(p.i)},${y(at(p.b, lo))}`)
      .join("") +
    "Z";
  const line = (run: { i: number; b: RatingBand }[]) => run.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(medianOf(p.b))}`).join("");

  let youAt: { cx: number; cy: number } | null = null;
  if (you) {
    const i = slots.findIndex((s) => "band" in s && you.rating >= s.band.from && (s.band.to === null || you.rating < s.band.to));
    if (i >= 0) {
      const b = (slots[i] as { band: RatingBand }).band;
      const f = b.to === null ? 0.5 : (you.rating - b.from) / (b.to - b.from);
      youAt = { cx: PAD.left + slotW * (i + f), cy: y(you.accuracy) };
    }
  }
  const hovered = hover !== null && "band" in slots[hover] ? (slots[hover] as { band: RatingBand }).band : null;

  return (
    <figure className="acc-chart">
      <figcaption className="acc-cap">
        {CLASS_NAME[tc]}: accuracy by rating. The line is the median game; the darker wash holds the middle half of games, the lighter one 80% of them.
      </figcaption>
      <div className="acc-plot" ref={wrap} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`${CLASS_NAME[tc]} accuracy by rating: the median and the spread of games in each rating band. The table below has every number.`}>
          {Y_TICKS.map((t) => (
            <g key={t}>
              <line className="acc-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="acc-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {hover !== null && hovered && <line className="acc-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />}
          {runs.map((run, k) =>
            run.length ? (
              <g key={k}>
                {run.length > 1 ? (
                  <>
                    <path className="acc-wash acc-wash-80" d={area(run, 10, 90)} />
                    <path className="acc-wash acc-wash-50" d={area(run, 25, 75)} />
                    <path className="acc-line" d={line(run)} />
                  </>
                ) : (
                  // A band on its own (after a gap): its spread as a bar, since a wash needs two points.
                  <>
                    <rect className="acc-wash acc-wash-80" x={x(run[0].i) - slotW * 0.22} width={slotW * 0.44} y={y(at(run[0].b, 90))} height={y(at(run[0].b, 10)) - y(at(run[0].b, 90))} rx={4} />
                    <rect className="acc-wash acc-wash-50" x={x(run[0].i) - slotW * 0.22} width={slotW * 0.44} y={y(at(run[0].b, 75))} height={y(at(run[0].b, 25)) - y(at(run[0].b, 75))} rx={4} />
                  </>
                )}
                {run.map((p) => (
                  <circle key={p.i} className="acc-dot" cx={x(p.i)} cy={y(medianOf(p.b))} r={4} />
                ))}
              </g>
            ) : null,
          )}
          {slots.map((s, i) =>
            "gap" in s ? (
              <text key={i} className="acc-axis" x={x(i)} y={HEIGHT - 10} textAnchor="middle">
                …
              </text>
            ) : (
              (!everyOther || i % 2 === 0 || i === slots.length - 1) && (
                <text key={i} className="acc-axis" x={x(i)} y={HEIGHT - 10} textAnchor="middle">
                  {shortLabel(s.band)}
                </text>
              )
            ),
          )}
          {youAt && (
            <g>
              <circle className="acc-you" cx={youAt.cx} cy={youAt.cy} r={6} />
              <text className="acc-you-label" x={youAt.cx} y={youAt.cy - 12} textAnchor="middle">
                Your game
              </text>
            </g>
          )}
          {slots.map((s, i) =>
            "band" in s ? <rect key={i} className="acc-hit" x={PAD.left + slotW * i} y={PAD.top} width={slotW} height={plotH} onPointerEnter={() => setHover(i)} /> : null,
          )}
        </svg>
        {hover !== null && hovered && (
          <div className="acc-tip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90) }}>
            <b>Rated {bandLabel(hovered)}</b>
            <span>Median {one(medianOf(hovered))}</span>
            <span>
              Middle half {one(at(hovered, 25))}–{one(at(hovered, 75))}
            </span>
            <span>
              80% of games {one(at(hovered, 10))}–{one(at(hovered, 90))}
            </span>
            <span className="muted">{hovered.n.toLocaleString("en-US")} player-games</span>
          </div>
        )}
      </div>
    </figure>
  );
}
