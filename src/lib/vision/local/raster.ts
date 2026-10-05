/**
 * Minimal raster helpers for on-device board reading. Works on plain RGBA buffers
 * (canvas ImageData in the browser, decoded files in tests), so nothing here
 * depends on the DOM.
 */
export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

/** Luminance (0–255) of a raster, optionally box-downscaled so the long side is at most `maxDim`. */
export function luminance(img: Raster, maxDim = Infinity): { width: number; height: number; lum: Float32Array; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const lum = new Float32Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let s = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          n++;
        }
      }
      lum[y * w + x] = s / n;
    }
  }
  return { width: w, height: h, lum, scale };
}

/**
 * Crops the rectangle (x, y, w, h) in source pixels (may extend past the edges,
 * which reads as edge pixels) and resamples it to `out`×`out` RGB with area
 * averaging. Returns channel-major floats in 0–1, the network's input layout.
 */
export function cropToTensor(img: Raster, x: number, y: number, w: number, h: number, out: number, target: Float32Array, offset: number) {
  const d = img.data;
  const plane = out * out;
  const cx = w / out;
  const cy = h / out;
  // Sub-samples per output pixel: enough to average over the source area.
  const nx = Math.max(1, Math.min(6, Math.round(cx)));
  const ny = Math.max(1, Math.min(6, Math.round(cy)));
  for (let oy = 0; oy < out; oy++) {
    for (let ox = 0; ox < out; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ny; j++) {
        const py = Math.min(img.height - 1, Math.max(0, Math.floor(y + (oy + (j + 0.5) / ny) * cy)));
        for (let i = 0; i < nx; i++) {
          const px = Math.min(img.width - 1, Math.max(0, Math.floor(x + (ox + (i + 0.5) / nx) * cx)));
          const k = (py * img.width + px) * 4;
          r += d[k];
          g += d[k + 1];
          b += d[k + 2];
        }
      }
      const n = nx * ny * 255;
      const o = offset + oy * out + ox;
      target[o] = r / n;
      target[o + plane] = g / n;
      target[o + 2 * plane] = b / n;
    }
  }
}
