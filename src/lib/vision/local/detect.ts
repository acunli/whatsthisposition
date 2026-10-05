/**
 * Finds a flat 8×8 chessboard in a screenshot or scan, without any manual crop.
 *
 * Square boundaries are the only long edges in an image that switch direction
 * along their length (light→dark on one square, dark→light on the next), so for
 * every column we multiply the summed positive and negative horizontal gradients
 * (and likewise for rows). The board shows up as 7 evenly spaced peaks; we search
 * every spacing and offset for the best such comb, refine it to sub-pixel
 * accuracy, then check that the cells really alternate light and dark.
 * (Idea after tensorflow_chessbot's gradient method, MIT; independent code.)
 */
import { luminance, type Raster } from "./raster";

export interface BoardGrid {
  /** Board's top-left corner and the size of one square, in source pixels. */
  x: number;
  y: number;
  cellW: number;
  cellH: number;
  /** 0–1: how clearly the cells alternate light and dark. */
  confidence: number;
}

const WORK = 900;

/** Per-column (axis "x") or per-row (axis "y") strength of alternating edges. */
function profile(lum: Float32Array, w: number, h: number, axis: "x" | "y"): Float32Array {
  const n = axis === "x" ? w : h;
  const pos = new Float64Array(n);
  const neg = new Float64Array(n);
  if (axis === "x") {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w - 1; x++) {
        const g = lum[row + x + 1] - lum[row + x];
        if (g > 0) pos[x] += g;
        else neg[x] -= g;
      }
    }
  } else {
    for (let y = 0; y < h - 1; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const g = lum[row + w + x] - lum[row + x];
        if (g > 0) pos[y] += g;
        else neg[y] -= g;
      }
    }
  }
  const v = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    v[i] = Math.sqrt(pos[i] * neg[i]);
    mean += v[i];
  }
  mean = mean / n || 1;
  for (let i = 0; i < n; i++) v[i] /= mean;
  return v;
}

const at = (v: Float32Array, p: number) => {
  const i = Math.round(p);
  let m = 0;
  for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < v.length && v[k] > m) m = v[k];
  return m;
};

/**
 * X-corner response: where four squares meet, the diagonal neighbours match and the
 * adjacent ones differ. Text and UI rarely produce this, so it singles out boards.
 * Value at (x, y) refers to the corner at the top-left of pixel (x, y).
 */
function cornerMap(lum: Float32Array, w: number, h: number, r: number): Float32Array {
  // 2×2 box blur first so JPEG noise and fine texture don't fire.
  const b = new Float32Array(w * h);
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) b[y * w + x] = (lum[y * w + x] + lum[y * w + x + 1] + lum[(y + 1) * w + x] + lum[(y + 1) * w + x + 1]) / 4;
  const out = new Float32Array(w * h);
  const o = r;
  for (let y = o + 1; y < h - o - 1; y++) {
    for (let x = o + 1; x < w - o - 1; x++) {
      const tl = b[(y - o - 1) * w + (x - o - 1)];
      const tr = b[(y - o - 1) * w + (x + o - 1)];
      const bl = b[(y + o - 1) * w + (x - o - 1)];
      const br = b[(y + o - 1) * w + (x + o - 1)];
      const v = Math.abs(tl + br - tr - bl) - 1.5 * (Math.abs(tl - br) + Math.abs(tr - bl));
      if (v > 0) out[y * w + x] = v;
    }
  }
  return out;
}

function cornerProfiles(c: Float32Array, w: number, h: number) {
  const px = new Float32Array(w);
  const py = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = c[y * w + x];
    px[x] += v;
    py[y] += v;
  }
  // Shift by one: corner index x is the boundary at edge coordinate x, while comb positions use profile index + 1.
  const norm = (v: Float32Array) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length - 1; i++) out[i] = v[i + 1] / m;
    return out;
  };
  return { px: norm(px), py: norm(py) };
}

/** How many of the 49 inner lattice points of a candidate look like real X-corners (0–1). */
function latticeSupport(c: Float32Array, w: number, h: number, x0: number, y0: number, sx: number, sy: number, ref: number): number {
  let hit = 0;
  for (let l = 1; l <= 7; l++) {
    for (let k = 1; k <= 7; k++) {
      const cx = Math.round(x0 + k * sx);
      const cy = Math.round(y0 + l * sy);
      let m = 0;
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (x >= 0 && y >= 0 && x < w && y < h && c[y * w + x] > m) m = c[y * w + x];
      if (m > ref) hit++;
    }
  }
  return hit / 49;
}

/** Score of a comb of 7 internal lines at spacing s and offset o: peaks on the lines minus values midway between them. */
function combScore(v: Float32Array, s: number, o: number) {
  let lines = 0;
  let mids = 0;
  for (let k = 1; k <= 7; k++) lines += at(v, o + k * s);
  for (let k = 0; k < 8; k++) mids += at(v, o + (k + 0.5) * s);
  return lines - (mids * 7) / 8;
}

/** Best comb for each spacing. */
function combs(v: Float32Array, minS: number, maxS: number, step: number) {
  const out: { s: number; o: number; score: number }[] = [];
  for (let s = minS; s <= maxS; s += step) {
    let best = { s, o: 0, score: -Infinity };
    for (let o = Math.floor(-0.06 * s); o <= Math.ceil(v.length - 7.94 * s); o++) {
      const score = combScore(v, s, o);
      if (score > best.score) best = { s, o, score };
    }
    out.push(best);
  }
  return out;
}

/** The few best, well-separated offsets for one spacing (text lines or patterns can beat the true board on raw score). */
function topOffsets(v: Float32Array, s: number, n: number) {
  const all: { o: number; score: number }[] = [];
  for (let o = Math.floor(-0.06 * s); o <= Math.ceil(v.length - 7.94 * s); o++) all.push({ o, score: combScore(v, s, o) });
  all.sort((a, b) => b.score - a.score);
  const out: typeof all = [];
  for (const c of all) {
    if (out.length >= n || c.score <= 0) break;
    if (out.every((x) => Math.abs(x.o - c.o) > 0.35 * s)) out.push(c);
  }
  return out;
}

/** Sub-pixel refinement: fit o + k·s through the 7 local peaks. */
function refine(v: Float32Array, s: number, o: number) {
  const ks: number[] = [];
  const ps: number[] = [];
  for (let k = 1; k <= 7; k++) {
    const c = o + k * s;
    let bi = Math.round(c);
    for (let i = Math.round(c - 2); i <= Math.round(c + 2); i++) if (i > 0 && i < v.length - 1 && v[i] > v[bi]) bi = i;
    if (bi <= 0 || bi >= v.length - 1) continue;
    const a = v[bi - 1];
    const b = v[bi];
    const d = v[bi + 1];
    const den = a - 2 * b + d;
    // Profile index i is the step between pixels i and i+1, i.e. the boundary at edge coordinate i + 1.
    ps.push(bi + 1 + (den !== 0 ? (0.5 * (a - d)) / den : 0));
    ks.push(k);
  }
  if (ks.length < 4) return { s, o: o + 1 };
  const n = ks.length;
  const mk = ks.reduce((x, y) => x + y, 0) / n;
  const mp = ps.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ks[i] - mk) * (ps[i] - mp);
    den += (ks[i] - mk) ** 2;
  }
  const s2 = num / den;
  return { s: s2, o: mp - s2 * mk };
}

/** Light/dark alternation of the 64 cells, sampled near their corners (pieces sit in the middle). */
export function checkerContrast(lum: Float32Array, w: number, h: number, x0: number, y0: number, sx: number, sy: number): number {
  const vals: number[][] = [[], []];
  const patch = (cx: number, cy: number) => {
    let s = 0;
    let n = 0;
    const r = Math.max(1, Math.round(Math.min(sx, sy) * 0.08));
    for (let y = Math.round(cy - r); y <= Math.round(cy + r); y++) {
      for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        s += lum[y * w + x];
        n++;
      }
    }
    return n ? s / n : NaN;
  };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const xs = [x0 + (c + 0.14) * sx, x0 + (c + 0.86) * sx];
      const ys = [y0 + (r + 0.14) * sy, y0 + (r + 0.86) * sy];
      const corners = [patch(xs[0], ys[0]), patch(xs[1], ys[0]), patch(xs[0], ys[1]), patch(xs[1], ys[1])].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
      if (corners.length < 2) continue;
      // The middle of the corner values: robust to a coordinate label or a piece reaching one corner.
      const m = corners.length === 4 ? (corners[1] + corners[2]) / 2 : corners[Math.floor(corners.length / 2)];
      vals[(r + c) % 2].push(m);
    }
  }
  const stat = (a: number[]) => {
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    const sorted = [...a].sort((x, y) => x - y);
    // Spread from the inner 80%: highlighted squares are allowed to differ.
    const lo = sorted[Math.floor(a.length * 0.1)];
    const hi = sorted[Math.ceil(a.length * 0.9) - 1];
    return { mean, med: sorted[Math.floor(a.length / 2)], spread: hi - lo };
  };
  if (vals[0].length < 20 || vals[1].length < 20) return 0;
  const A = stat(vals[0]);
  const B = stat(vals[1]);
  return Math.abs(A.med - B.med) / (A.spread / 2 + B.spread / 2 + 6);
}

export interface Candidate {
  x: number;
  y: number;
  sx: number;
  sy: number;
  contrast: number;
  /** Share of the 49 inner lattice points that are real X-corners, 0–1. */
  lines: number;
}

/** All plausible boards at one working resolution, each scored by its X-corner lattice and light/dark alternation. */
export function candidatesAt(img: Raster, work: number): { list: Candidate[]; scale: number } {
  const { width: w, height: h, lum, scale } = luminance(img, work);
  if (w < 48 || h < 48) return { list: [], scale };
  const corners = cornerMap(lum, w, h, 2);
  // A corner counts when it's clearly stronger than the image's typical response.
  const sorted = Array.from(corners.filter((v) => v > 0)).sort((a, b) => a - b);
  const ref = Math.max(8, sorted.length ? sorted[Math.floor(sorted.length * 0.9)] * 0.5 : 8);
  const edges = { x: profile(lum, w, h, "x"), y: profile(lum, w, h, "y") };
  const cp = cornerProfiles(corners, w, h);
  const minS = Math.max(5, Math.min(w, h) / 64);
  const maxS = (Math.min(w, h) / 8) * 1.04;
  const list: Candidate[] = [];
  const seen = new Set<string>();
  for (const [vx, vy] of [
    [edges.x, edges.y],
    [cp.px, cp.py],
  ]) {
    const cx = combs(vx, minS, maxS, 0.5);
    const cy = combs(vy, minS, maxS, 0.5);
    // Spacing pairs (square cells, within 4%), best first, keeping distinct spacings only.
    const pairs: { sx: number; sy: number; score: number }[] = [];
    for (const a of cx) for (const b of cy) if (Math.abs(a.s - b.s) <= 0.04 * a.s && a.score + b.score > 0) pairs.push({ sx: a.s, sy: b.s, score: a.score + b.score });
    pairs.sort((a, b) => b.score - a.score);
    const spacings: typeof pairs = [];
    for (const p of pairs) {
      if (spacings.length >= 6) break;
      if (spacings.every((q) => Math.abs(q.sx - p.sx) > 0.08 * q.sx)) spacings.push(p);
    }
    for (const sp of spacings) {
      for (const ox of topOffsets(vx, sp.sx, 4)) {
        for (const oy of topOffsets(vy, sp.sy, 4)) {
          const rx = refine(vx, sp.sx, ox.o);
          const ry = refine(vy, sp.sy, oy.o);
          if (Math.abs(rx.s - ry.s) > 0.035 * Math.max(rx.s, ry.s)) continue;
          if (rx.o < -0.08 * rx.s || ry.o < -0.08 * ry.s || rx.o + 8 * rx.s > w + 0.08 * rx.s || ry.o + 8 * ry.s > h + 0.08 * ry.s) continue;
          const key = `${Math.round(rx.o)},${Math.round(ry.o)},${Math.round(rx.s)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({
            x: rx.o / scale,
            y: ry.o / scale,
            sx: rx.s / scale,
            sy: ry.s / scale,
            contrast: checkerContrast(lum, w, h, rx.o, ry.o, rx.s, ry.s),
            lines: latticeSupport(corners, w, h, rx.o, ry.o, rx.s, ry.s, ref),
          });
        }
      }
    }
  }
  return { list, scale };
}

export function detectBoard(img: Raster): BoardGrid | null {
  // Two working sizes: fine detail for small boards, and a coarser one that averages
  // away textures (hatching, wood grain) that can fake a grid at full resolution.
  const fine = Math.min(WORK, Math.max(img.width, img.height));
  const all = [...candidatesAt(img, fine).list, ...candidatesAt(img, fine / 2).list, ...candidatesAt(img, fine / 3).list];
  if (!all.length) return null;
  // A board needs both: a lattice of X-corners (pieces hide a few) and cells that alternate.
  const score = (c: Candidate) => c.lines * Math.min(1, c.contrast / 1.2) + 0.15 * Math.min(1, c.contrast / 3);
  all.sort((a, b) => score(b) - score(a));
  const top = score(all[0]);
  // Among near-ties, the larger board (a sub-grid of a board also alternates).
  const pick = all.filter((c) => score(c) >= top * 0.9).sort((a, b) => b.sx - a.sx)[0];
  if (pick.lines < 0.3 && pick.contrast < 1) return null;
  return { x: pick.x, y: pick.y, cellW: pick.sx, cellH: pick.sy, confidence: Math.max(0, Math.min(1, score(pick))) };
}
