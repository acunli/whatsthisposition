"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gridToPlacement, type Recognition, type RecognitionError, type RecognitionResponse } from "@/lib/vision/grid";
import type { Placement, Square } from "@/lib/chess/types";

interface Props {
  onRecognized: (placement: Placement, uncertain: Square[], notes: string, whiteAtBottom: boolean) => void;
  /** A file picked on the home page, opened straight into the cropper. */
  initialFile?: File | null;
  onInitialConsumed?: () => void;
}

type Stage = "empty" | "crop" | "reading" | "done" | "error";
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_SOURCE = 2200;
const MAX_UPLOAD = 1280;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be opened as an image."));
    };
    img.src = url;
  });
}

/** Draws the source rotated by `deg` onto a fresh canvas sized to fit. */
function rotateToCanvas(img: HTMLImageElement, deg: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const rad = (deg * Math.PI) / 180;
  const cw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const ch = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const c = document.createElement("canvas");
  c.width = Math.round(cw);
  c.height = Math.round(ch);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

function cropToBlob(src: HTMLCanvasElement, crop: Crop): Promise<Blob> {
  const sx = crop.x * src.width;
  const sy = crop.y * src.height;
  const sw = crop.w * src.width;
  const sh = crop.h * src.height;
  const scale = Math.min(1, MAX_UPLOAD / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  out.getContext("2d")!.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the image."))), "image/jpeg", 0.9));
}

export function PhotoInput({ onRecognized, initialFile, onInitialConsumed }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("empty");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [fine, setFine] = useState(0);
  const [crop, setCrop] = useState<Crop>({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
  const [whiteAtBottom, setWhiteAtBottom] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Recognition["rows"] | null>(null);
  const [dragging, setDragging] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/recognize")
      .then((r) => r.json())
      .then((j: { configured: boolean; provider: string | null }) => {
        if (!alive) return;
        setConfigured(j.configured);
        setProvider(j.provider);
      })
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const render = useCallback((deg: number) => {
    if (!imgRef.current) return;
    const c = rotateToCanvas(imgRef.current, deg);
    canvasRef.current = c;
    setPreview(c.toDataURL("image/jpeg", 0.85));
  }, []);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image file. Use a JPEG, PNG or WebP photo or screenshot.");
      setStage("error");
      return;
    }
    try {
      imgRef.current = await loadImage(file);
      setQuarter(0);
      setFine(0);
      setCrop({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
      render(0);
      setStage("crop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the image.");
      setStage("error");
    }
  };

  useEffect(() => {
    if (!initialFile) return;
    // Defer so the handed-over file is processed outside the effect body.
    queueMicrotask(() => void accept(initialFile));
    onInitialConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the handed-over file
  }, [initialFile]);

  const rotate = (q: number, f: number) => {
    setQuarter(q);
    setFine(f);
    setCrop({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
    render(q * 90 + f);
  };

  const read = async () => {
    if (!canvasRef.current || whiteAtBottom === null) return;
    setStage("reading");
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const blob = await cropToBlob(canvasRef.current, crop);
      const form = new FormData();
      form.append("image", blob, "board.jpg");
      const res = await fetch("/api/recognize", { method: "POST", body: form, signal: ac.signal });
      const json = (await res.json()) as RecognitionResponse | RecognitionError;
      if (!json.ok) {
        setError(json.message);
        setStage("error");
        return;
      }
      setRows(json.rows);
      const { placement, uncertain } = gridToPlacement(json.rows, whiteAtBottom);
      onRecognized(placement, uncertain, json.notes, whiteAtBottom);
      setStage("done");
    } catch (e) {
      if (ac.signal.aborted) {
        setStage("crop");
        return;
      }
      setError(e instanceof Error && e.message ? "Couldn't reach the server to read the photo." : "Something went wrong.");
      setStage("error");
    }
  };

  // Crop box dragging (move or resize from a corner), in fractions of the preview.
  const startDrag = (mode: "move" | "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const start = { x: e.clientX, y: e.clientY, crop };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.width;
      const dy = (ev.clientY - start.y) / box.height;
      const c = { ...start.crop };
      const min = 0.08;
      if (mode === "move") {
        c.x = Math.min(1 - c.w, Math.max(0, c.x + dx));
        c.y = Math.min(1 - c.h, Math.max(0, c.y + dy));
      } else {
        if (mode.includes("w")) {
          const nx = Math.min(c.x + c.w - min, Math.max(0, c.x + dx));
          c.w += c.x - nx;
          c.x = nx;
        }
        if (mode.includes("e")) c.w = Math.min(1 - c.x, Math.max(min, c.w + dx));
        if (mode.includes("n")) {
          const ny = Math.min(c.y + c.h - min, Math.max(0, c.y + dy));
          c.h += c.y - ny;
          c.y = ny;
        }
        if (mode.includes("s")) c.h = Math.min(1 - c.y, Math.max(min, c.h + dy));
      }
      setCrop(c);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const reset = () => {
    abortRef.current?.abort();
    imgRef.current = null;
    canvasRef.current = null;
    setPreview(null);
    setRows(null);
    setWhiteAtBottom(null);
    setStage("empty");
    setError(null);
  };

  if (configured === false) {
    return (
      <div className="pane">
        <div className="notice">
          <b>Photo reading isn&apos;t set up on this server.</b> It needs a vision API key: put your key in <code>SOCLAAS_API_KEY</code> in <code>.env.local</code> and restart the server. Meanwhile, paste a FEN or set up the position by hand. Both work fully offline.
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      {(stage === "empty" || (stage === "error" && !preview)) && (
        <div
          className={dragging ? "drop drop-on" : "drop"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void accept(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        >
          <span className="drop-icon">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <span>
            <span className="drop-title">Drop a photo or screenshot</span>
            <span className="drop-sub">or tap to choose · JPEG, PNG, WebP</span>
          </span>
          <span />
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={(e) => void accept(e.target.files?.[0])}
          />
        </div>
      )}

      {preview && stage !== "empty" && (
        <>
          <div className="cropper" ref={boxRef}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your photo" draggable={false} />
            {stage === "crop" && (
              <div
                className="crop-box"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={startDrag("move")}
              >
                <div className="crop-grid" aria-hidden />
                {(["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span key={h} className={`crop-handle crop-${h}`} onPointerDown={startDrag(h)} />
                ))}
              </div>
            )}
            {stage === "reading" && (
              <div className="reading">
                <span className="scanline" aria-hidden />
                <span>Reading 64 squares…</span>
              </div>
            )}
          </div>

          {stage === "crop" && (
            <>
              <p className="field-note">Drag the frame to the board&apos;s edges. The grid should line up with the squares.</p>
              <div className="row" style={{ margin: "10px 0 14px" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => rotate((quarter + 3) % 4, fine)}>
                  ↺ 90°
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => rotate((quarter + 1) % 4, fine)}>
                  ↻ 90°
                </button>
                <label className="fine">
                  Straighten
                  <input type="range" min={-15} max={15} step={0.5} value={fine} onChange={(e) => rotate(quarter, Number(e.target.value))} />
                  <span className="mono">{fine > 0 ? "+" : ""}{fine}°</span>
                </label>
              </div>
              <fieldset className={`field ${whiteAtBottom === null ? "field-required" : ""}`}>
                <legend className="field-label">Which side is at the bottom of the photo?</legend>
                <div className="seg-group">
                  <button className={whiteAtBottom === true ? "seg seg-on" : "seg"} onClick={() => setWhiteAtBottom(true)} aria-pressed={whiteAtBottom === true}>
                    <span className="side-dot side-w" aria-hidden /> White&apos;s side
                  </button>
                  <button className={whiteAtBottom === false ? "seg seg-on" : "seg"} onClick={() => setWhiteAtBottom(false)} aria-pressed={whiteAtBottom === false}>
                    <span className="side-dot side-b" aria-hidden /> Black&apos;s side
                  </button>
                </div>
              </fieldset>
              <div className="row">
                <button className="btn btn-gold" disabled={whiteAtBottom === null} onClick={() => void read()}>
                  Read the board
                </button>
                <button className="btn btn-ghost" onClick={reset}>
                  Choose another photo
                </button>
              </div>
            </>
          )}

          {stage === "reading" && (
            <div className="row">
              <button className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          )}

          {stage === "done" && (
            <div className="done">
              <p className="pane-text">
                <b>Board read.</b> Compare it with your photo and fix anything that&apos;s off. Squares marked <b>?</b> were hard to read.
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (!rows || whiteAtBottom === null) return;
                    const flipped = !whiteAtBottom;
                    setWhiteAtBottom(flipped);
                    const { placement, uncertain } = gridToPlacement(rows, flipped);
                    onRecognized(placement, uncertain, "", flipped);
                  }}
                >
                  Wrong way round? Swap sides
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setStage("crop")}>
                  Re-crop and read again
                </button>
                <button className="btn btn-ghost btn-sm" onClick={reset}>
                  New photo
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {stage === "error" && error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
          <div className="row">
            {preview && (
              <button className="btn btn-sm" onClick={() => setStage("crop")}>
                Adjust and retry
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Use a different photo
            </button>
          </div>
        </div>
      )}

      <p className="privacy">
        Your photo is sent to this site&apos;s server and on to {provider === "anthropic" ? "Anthropic's API" : "the NUS SoCLaaS AI gateway"} to read the pieces, then discarded. We don&apos;t save it.
      </p>
    </div>
  );
}
