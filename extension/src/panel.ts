/**
 * The review card (panel.html), shown in an iframe on Chess.com. It receives the
 * finished game from the content script, runs the same review as the website (Stockfish
 * 19 in workers on this computer, the same labels and accuracy), shows the accuracy and
 * how many moves of each kind each player made, and links to the full step-by-step
 * review on the website.
 */
import { createEnginePool, type EnginePool } from "@/lib/engine/pool";
import { gameAccuracy } from "@/lib/review/accuracy";
import { loadBook } from "@/lib/review/book";
import { CLASS_INFO, CLASS_ORDER, type MoveClass } from "@/lib/review/classify";
import { classIconSvg } from "@/lib/review/classGlyphs";
import type { ChessComGame } from "@/lib/review/chesscomGame";
import { DEFAULT_REVIEW_DEPTH, REVIEW_DEPTHS, VERIFY_EXTRA } from "@/lib/review/depths";
import { parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
import { analysePositions, classifyGame, criticalPositions, tally } from "@/lib/review/review";
import { reviewLink } from "@/lib/review/share";
import { SITE_URL } from "@/lib/brand";
import { markSvg } from "@/lib/logoPaths";
import { remoteEnginePool } from "./remoteEngine";

const PARENT = "https://www.chess.com";
const TABLE: MoveClass[] = CLASS_ORDER.filter((c) => c !== "forced");

const app = document.getElementById("app")!;
let game: ChessComGame | null = null;
let parsed: ParsedGame | null = null;
let depthIdx = DEFAULT_REVIEW_DEPTH;
let running = false;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tell = (msg: object) => parent.postMessage(msg, PARENT);

// The card follows the panel's height.
new ResizeObserver(() => tell({ type: "wtp:size", height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(document.documentElement);

function header() {
  return `<header class="head">${markSvg(26)}<span class="word">what’sthis<b>position</b></span><button class="x" type="button" data-close aria-label="Close">×</button></header>`;
}

function players() {
  if (!game || !parsed) return "";
  const elo = (v?: string) => (v ? ` <span class="elo">${esc(v)}</span>` : "");
  return `<p class="players"><span>${esc(game.white)}${elo(parsed.whiteElo)}</span><span class="vs">vs</span><span>${esc(game.black)}${elo(parsed.blackElo)}</span></p>${game.message ? `<p class="result">${esc(game.message)}</p>` : ""}`;
}

function bind() {
  app.querySelector("[data-close]")?.addEventListener("click", () => tell({ type: "wtp:close" }));
  app.querySelectorAll<HTMLButtonElement>("[data-depth]").forEach((b) =>
    b.addEventListener("click", () => {
      depthIdx = Number(b.dataset.depth);
      renderStart();
    }),
  );
  app.querySelector("[data-analyse]")?.addEventListener("click", () => void analyse());
}

function renderStart() {
  const chips = REVIEW_DEPTHS.map((d, i) => `<button type="button" class="chip${i === depthIdx ? " on" : ""}" data-depth="${i}" aria-pressed="${i === depthIdx}" title="${esc(d.note)}">${d.label} · ${d.depth}</button>`).join("");
  app.innerHTML = `${header()}${players()}
    <button class="primary" type="button" data-analyse>Analyze this game</button>
    <div class="depths" role="group" aria-label="Search depth">${chips}</div>
    <p class="note">Stockfish 19 runs on your computer. Nothing is uploaded.</p>`;
  bind();
}

/** The progress view: drawn once, then only its text and bar change. */
function renderProgress(text: string, share: number) {
  let status = app.querySelector<HTMLElement>("[data-status]");
  if (!status) {
    app.innerHTML = `${header()}${players()}
      <p class="status" data-status aria-live="polite"></p>
      <div class="bar" aria-hidden="true"><span data-bar></span></div>
      <p class="note">You can keep using Chess.com; the review runs in the background.</p>`;
    bind();
    status = app.querySelector<HTMLElement>("[data-status]")!;
  }
  status.textContent = text;
  app.querySelector<HTMLElement>("[data-bar]")!.style.width = `${Math.round(share * 100)}%`;
}

function renderDone(acc: Record<"w" | "b", number | null>, counts: Record<string, { w: number; b: number }>, opening: string | null) {
  const a = (v: number | null) => (v == null ? "–" : v.toFixed(1));
  const rows = TABLE.map((c) => {
    const t = counts[c] ?? { w: 0, b: 0 };
    return `<tr${t.w + t.b ? "" : ' class="zero"'}><td class="n">${t.w}</td><td class="cls">${classIconSvg(c, 18)}<span style="color:${CLASS_INFO[c].color}">${CLASS_INFO[c].label}</span></td><td class="n">${t.b}</td></tr>`;
  }).join("");
  const link = reviewLink(SITE_URL, game!.pgn, game!.bottom, REVIEW_DEPTHS[depthIdx].depth);
  app.innerHTML = `${header()}${players()}
    <div class="acc">
      <div><span class="acc-num">${a(acc.w)}</span><span class="acc-who">${esc(game!.white)}</span></div>
      <span class="acc-label">Accuracy</span>
      <div><span class="acc-num">${a(acc.b)}</span><span class="acc-who">${esc(game!.black)}</span></div>
    </div>
    ${opening ? `<p class="opening">${esc(opening)}</p>` : ""}
    <table class="table"><thead><tr><th>${esc(game!.white)}</th><th></th><th>${esc(game!.black)}</th></tr></thead><tbody>${rows}</tbody></table>
    <a class="primary" href="${esc(link)}" target="_blank" rel="noopener">See every move explained →</a>
    <p class="note">Opens what’sthisposition with this game, step by step.</p>`;
  bind();
}

/** What went wrong, plus a way out: the website runs the same review with its own engine. */
function renderError(message: string) {
  const link = game ? reviewLink(SITE_URL, game.pgn, game.bottom, REVIEW_DEPTHS[depthIdx].depth) : SITE_URL;
  app.innerHTML = `${header()}${players()}<p class="status error">${esc(message)}</p>
    <button class="primary" type="button" data-analyse>Try again</button>
    <a class="secondary" href="${esc(link)}" target="_blank" rel="noopener">Review it on what’sthisposition instead →</a>`;
  bind();
}

/**
 * Engines for the review: in the hidden engine page first (the card itself sits inside
 * Chess.com's page, where the browser may refuse to start workers), then in the card as
 * a fallback. A pool only counts once its engine has answered a first search.
 */
async function startEngines(): Promise<EnginePool> {
  const problems: string[] = [];
  for (const [where, make] of [
    ["engine page", remoteEnginePool],
    ["card", async () => createEnginePool()],
  ] as const) {
    let pool: EnginePool | null = null;
    try {
      pool = await make();
      await pool.searchers[0]({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", depth: 1 });
      document.documentElement.dataset.engine = where; // which one runs (for tests and bug reports)
      return pool;
    } catch (e) {
      pool?.dispose();
      problems.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Stockfish couldn't start (${problems.join("; ")}).`);
}

async function analyse() {
  if (!parsed || running) return;
  running = true;
  const g = parsed;
  const depth = REVIEW_DEPTHS[depthIdx].depth;
  const total = g.moves.length + 1;
  let pool: EnginePool | null = null;
  try {
    renderProgress("Starting Stockfish…", 0);
    pool = await startEngines();
    const engines = pool;
    const book = await loadBook().catch(() => null);
    let done = 0;
    renderProgress(`Stockfish is reviewing: 0/${total} positions · depth ${depth}`, 0);
    const first = await analysePositions(g, engines.searchers, {
      depth,
      onPosition: () => {
        done++;
        renderProgress(`Stockfish is reviewing: ${done}/${total} positions${engines.size > 1 ? ` · ${engines.size} engines` : ""} · depth ${depth}`, (done / total) * 0.85);
      },
    });
    // Sharp moments are searched deeper, as on the website, so sacrifices and blunders aren't misjudged.
    const crit = criticalPositions(classifyGame(g, first, book), first, depth + VERIFY_EXTRA);
    let positions = first;
    if (crit.length) {
      let checked = 0;
      renderProgress(`Double-checking ${crit.length} critical positions at depth ${depth + VERIFY_EXTRA}`, 0.85);
      positions = await analysePositions(g, engines.searchers, {
        depth: depth + VERIFY_EXTRA,
        indices: crit,
        existing: first,
        onPosition: () => {
          checked++;
          renderProgress(`Double-checking ${checked}/${crit.length} critical positions at depth ${depth + VERIFY_EXTRA}`, 0.85 + (checked / crit.length) * 0.15);
        },
      });
    }
    const review = classifyGame(g, positions, book);
    renderDone(gameAccuracy(review.moves), tally(review.moves), review.opening ? `${review.opening.eco} · ${review.opening.name}` : null);
  } catch (e) {
    console.error("what’sthisposition review failed", e);
    renderError(e instanceof Error && e.message !== "cancelled" ? e.message : "The engine stopped.");
  } finally {
    pool?.dispose();
    running = false;
  }
}

addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== PARENT || e.source !== parent) return;
  const msg = e.data as { type?: string; game?: ChessComGame };
  if (msg?.type !== "wtp:game" || !msg.game?.pgn || running) return;
  try {
    parsed = parseFirstGame(msg.game.pgn);
    game = msg.game;
    renderStart();
  } catch {
    renderError("This game couldn't be read.");
  }
});

app.innerHTML = `${header()}<p class="status">Reading the game…</p>`;
bind();
tell({ type: "wtp:ready" });
