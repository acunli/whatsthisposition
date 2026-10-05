/**
 * Inference for the square classifier (a small CNN trained on synthetic boards by
 * scripts/vision/train.py). Plain TypeScript, no ML runtime: about 8M multiply-adds
 * per square, so a whole board takes well under a second on a phone.
 *
 * Layout (must match train.py): conv3×3(3→20)·pool · conv(20→40)·conv(40→40)·pool ·
 * conv(40→80)·pool · fc(1280→128) · fc(128→13). BatchNorm is folded into the convs;
 * every conv and fc1 is followed by ReLU.
 */

export const CLASSES = ["", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"] as const;
export type SquareClass = (typeof CLASSES)[number];
export const INPUT = 32;

interface Tensor {
  shape: number[];
  data: Float32Array;
}

export interface SquareNet {
  tensors: Tensor[];
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
}

/** Parses the weights file: "WTPS", tensor count, then per tensor ndim, dims, float16 data. */
export function parseNet(buf: ArrayBuffer): SquareNet {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "WTPS") throw new Error("not a square-classifier weights file");
  let p = 4;
  const n = dv.getUint32(p, true);
  p += 4;
  const tensors: Tensor[] = [];
  for (let t = 0; t < n; t++) {
    const nd = dv.getUint32(p, true);
    p += 4;
    const shape: number[] = [];
    for (let d = 0; d < nd; d++) {
      shape.push(dv.getUint32(p, true));
      p += 4;
    }
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = halfToFloat(dv.getUint16(p + 2 * i, true));
    p += 2 * size;
    tensors.push({ shape, data });
  }
  if (tensors.length !== 12) throw new Error(`expected 12 tensors, got ${tensors.length}`);
  return { tensors };
}

/** 3×3 convolution, padding 1, + bias + ReLU. */
function conv(input: Float32Array, cin: number, size: number, w: Tensor, b: Tensor): Float32Array {
  const cout = w.shape[0];
  const plane = size * size;
  const out = new Float32Array(cout * plane);
  const wd = w.data;
  for (let oc = 0; oc < cout; oc++) {
    const o = out.subarray(oc * plane, (oc + 1) * plane);
    o.fill(b.data[oc]);
    for (let ic = 0; ic < cin; ic++) {
      const inp = input.subarray(ic * plane, (ic + 1) * plane);
      const base = (oc * cin + ic) * 9;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const wv = wd[base + ky * 3 + kx];
          if (wv === 0) continue;
          const dy = ky - 1;
          const dx = kx - 1;
          const y0 = Math.max(0, -dy);
          const y1 = Math.min(size, size - dy);
          const x0 = Math.max(0, -dx);
          const x1 = Math.min(size, size - dx);
          for (let y = y0; y < y1; y++) {
            const orow = y * size;
            const irow = (y + dy) * size + dx;
            for (let x = x0; x < x1; x++) o[orow + x] += wv * inp[irow + x];
          }
        }
      }
    }
    for (let i = 0; i < plane; i++) if (o[i] < 0) o[i] = 0;
  }
  return out;
}

function pool(input: Float32Array, c: number, size: number): Float32Array {
  const half = size >> 1;
  const out = new Float32Array(c * half * half);
  for (let ch = 0; ch < c; ch++) {
    const ib = ch * size * size;
    const ob = ch * half * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const i = ib + 2 * y * size + 2 * x;
        out[ob + y * half + x] = Math.max(input[i], input[i + 1], input[i + size], input[i + size + 1]);
      }
    }
  }
  return out;
}

function dense(input: Float32Array, w: Tensor, b: Tensor, relu: boolean): Float32Array {
  const [nout, nin] = w.shape;
  const out = new Float32Array(nout);
  for (let o = 0; o < nout; o++) {
    let s = b.data[o];
    const row = o * nin;
    for (let i = 0; i < nin; i++) s += w.data[row + i] * input[i];
    out[o] = relu && s < 0 ? 0 : s;
  }
  return out;
}

export interface SquareOutput {
  probs: Float32Array;
  /** 128-d embedding (fc1 output), used to compare squares within one image. */
  embedding: Float32Array;
}

/** Runs one 3×32×32 input (channel-major, 0–1). */
export function classify(net: SquareNet, input: Float32Array): SquareOutput {
  const t = net.tensors;
  let x = conv(input, 3, 32, t[0], t[1]);
  x = pool(x, 20, 32);
  x = conv(x, 20, 16, t[2], t[3]);
  x = conv(x, 40, 16, t[4], t[5]);
  x = pool(x, 40, 16);
  x = conv(x, 40, 8, t[6], t[7]);
  x = pool(x, 80, 8);
  const embedding = dense(x, t[8], t[9], true);
  const logits = dense(embedding, t[10], t[11], false);
  let m = -Infinity;
  for (const v of logits) m = Math.max(m, v);
  const probs = new Float32Array(logits.length);
  let s = 0;
  for (let i = 0; i < logits.length; i++) {
    probs[i] = Math.exp(logits[i] - m);
    s += probs[i];
  }
  for (let i = 0; i < probs.length; i++) probs[i] /= s;
  return { probs, embedding };
}
