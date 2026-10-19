import "server-only";

/**
 * The preview card of a reviewed game (1200×630 PNG), as link previews show it: the board at
 * the moment worth seeing (the move's squares lit and its label on the piece), the move and its
 * label, both players' accuracy and the sharer's labelled moves. Drawn with next/og in the
 * site's type (Archivo, OFL, subset in src/assets/fonts) and pieces (public/pieces), which
 * next.config.ts traces into the routes that use it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { placementFromFen } from "../chess/fen";
import type { Color } from "../chess/types";
import { SITE_TAGLINE } from "../brand";
import { CLASS_INFO, type MoveClass } from "../review/classify";
import { CLASS_PATHS, CLASS_TEXT, STROKED } from "../review/classGlyphs";
import { CARD_CLASSES, sides, type ShareSummary } from "../review/shareCard";

export const CARD_SIZE = { width: 1200, height: 630 };

const ROOT = process.cwd();
const font = (f: string) => readFile(join(ROOT, "src/assets/fonts", f));
const PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
const assets = Promise.all([
  font("ArchivoCondensed-Black.ttf"),
  font("Archivo-SemiBold.ttf"),
  Promise.all(PIECES.map(async (p) => [p, `data:image/svg+xml;base64,${(await readFile(join(ROOT, "public/pieces", `${p}.svg`))).toString("base64")}`] as const)),
]).then(([display, text, pieces]) => ({ display, text, pieces: Object.fromEntries(pieces) as Record<string, string> }));

const BG = "#0c110f";
const SLAB = "#151c19";
const BONE = "#f1ede2";
const DIM = "#8f978f";
const BRAND = "#ff7629";
const SQ_L = "#eae6d6";
const SQ_D = "#5e8a6f";
const LIT = "rgba(255, 197, 61, 0.55)";

const BOARD = 534;
const SQ = BOARD / 8;
const FILES = "abcdefgh";

/** A label's round badge, as on the site: its text ("!!", "?") or its drawn glyph (src/lib/review/classGlyphs.ts). */
function Badge({ cls, size }: { cls: MoveClass; size: number }) {
  const text = CLASS_TEXT[cls];
  const d = CLASS_PATHS[cls];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size, background: CLASS_INFO[cls].color, color: "#fff", fontFamily: "Display", fontSize: size * ((text?.length ?? 0) > 1 ? 0.5 : 0.6), letterSpacing: (text?.length ?? 0) > 1 ? -1 : 0 }}>
      {text ??
        (d && (
          <svg width={size} height={size} viewBox="0 0 24 24">
            {STROKED.has(cls) ? <path d={d} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : <path d={d} fill="#fff" />}
          </svg>
        ))}
    </div>
  );
}

function Board({ s, pieces }: { s: ShareSummary; pieces: Record<string, string> }) {
  const fen = s.moment?.fen ?? s.finalFen;
  const placement = placementFromFen(fen);
  const flip = s.as === "b";
  const lit = new Set(s.moment ? [s.moment.from, s.moment.to] : []);
  const rows = [];
  for (let r = 0; r < 8; r++) {
    const cells = [];
    for (let c = 0; c < 8; c++) {
      const file = flip ? 7 - c : c;
      const rank = flip ? r : 7 - r;
      const sq = `${FILES[file]}${rank + 1}`;
      const p = placement[sq as keyof typeof placement];
      const light = (file + rank) % 2 === 1;
      cells.push(
        <div key={sq} style={{ display: "flex", position: "relative", width: SQ, height: SQ, background: light ? SQ_L : SQ_D }}>
          {lit.has(sq as never) && <div style={{ position: "absolute", left: 0, top: 0, width: SQ, height: SQ, background: LIT }} />}
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og draws plain img elements */}
          {p && <img src={pieces[`${p.color}${p.type.toUpperCase()}`]} width={SQ} height={SQ} style={{ position: "absolute", left: 0, top: 0 }} alt="" />}
          {s.moment && sq === s.moment.to && (
            <div style={{ display: "flex", position: "absolute", right: 2, top: 2 }}>
              <Badge cls={s.moment.cls} size={28} />
            </div>
          )}
        </div>,
      );
    }
    rows.push(
      <div key={r} style={{ display: "flex" }}>
        {cells}
      </div>,
    );
  }
  return <div style={{ display: "flex", flexDirection: "column", width: BOARD, height: BOARD, borderRadius: 10, overflow: "hidden" }}>{rows}</div>;
}

function Player({ s, color }: { s: ShareSummary; color: Color }) {
  const name = color === "w" ? s.white : s.black;
  const elo = color === "w" ? s.whiteElo : s.blackElo;
  const acc = s.accuracy[color];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", background: SLAB, borderRadius: 10 }}>
      <div style={{ width: 20, height: 20, borderRadius: 4, background: color === "w" ? BONE : "#2a332e", border: `2px solid ${color === "w" ? BONE : DIM}` }} />
      <div style={{ display: "flex", flex: 1, alignItems: "baseline", gap: 10, fontSize: 28, color: BONE, overflow: "hidden" }}>
        <span style={{ maxWidth: 300, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{name}</span>
        {elo && <span style={{ fontSize: 22, color: DIM }}>{elo}</span>}
      </div>
      <span style={{ fontFamily: "Display", fontSize: 40, color: BONE }}>{acc != null ? acc.toFixed(1) : "–"}</span>
    </div>
  );
}

/** The card for a reviewed game. */
export async function reviewCard(s: ShareSummary): Promise<ImageResponse> {
  const { display, text, pieces } = await assets;
  const { me } = sides(s);
  const mine = CARD_CLASSES.filter((c) => s.counts[s.as][c]);
  const acc = s.accuracy[s.as];
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: BG, padding: 48, gap: 48, fontFamily: "Text", color: BONE }}>
        <Board s={s} pieces={pieces} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: 40, letterSpacing: -0.5 }}>
            <span>what’sthis</span>
            <span style={{ color: BRAND }}>position</span>
          </div>
          <div style={{ display: "flex", marginTop: 34 }}>
            {s.moment ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <Badge cls={s.moment.cls} size={62} />
                  <span style={{ fontFamily: "Display", fontSize: 92, lineHeight: 1, letterSpacing: -1 }}>{s.moment.name}</span>
                </div>
                <span style={{ fontSize: 30, color: CLASS_INFO[s.moment.cls].color }}>
                  {`${CLASS_INFO[s.moment.cls].label} move by ${me}`}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: "Display", fontSize: 92, lineHeight: 1 }}>{acc != null ? acc.toFixed(1) : "Reviewed"}</span>
                <span style={{ fontSize: 30, color: DIM }}>{acc != null ? `accuracy for ${me}` : "every move explained"}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: "auto" }}>
            <Player s={s} color="w" />
            <Player s={s} color="b" />
            {mine.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 6, fontSize: 24, color: DIM }}>
                {mine.map((c) => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge cls={c} size={28} />
                    <span style={{ color: BONE }}>{s.counts[s.as][c]}</span>
                    <span>{CLASS_INFO[c].label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span style={{ marginTop: 22, fontSize: 22, color: DIM }}>{SITE_TAGLINE}</span>
        </div>
      </div>
    ),
    {
      ...CARD_SIZE,
      fonts: [
        { name: "Display", data: display, weight: 900, style: "normal" },
        { name: "Text", data: text, weight: 600, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" },
    },
  );
}
