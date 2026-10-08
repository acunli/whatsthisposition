/**
 * The hidden engine page (an offscreen document). It runs the Stockfish workers for the
 * review cards: each card connects a port, gets a pool of engines, and sends searches
 * to it. When the last card disconnects (closed, or its tab gone), the page asks to be
 * closed, which also stops the workers.
 */
import { createEnginePool } from "@/lib/engine/pool";

let open = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "wtp-engine") return;
  open++;
  const pool = createEnginePool();
  port.postMessage({ type: "size", size: pool.size });
  port.onMessage.addListener((m: { type?: string; id: number; k: number; req: Parameters<(typeof pool.searchers)[number]>[0] }) => {
    if (m?.type !== "search" || !pool.searchers[m.k]) return;
    pool.searchers[m.k](m.req).then(
      (lines) => port.postMessage({ type: "result", id: m.id, lines }),
      (e: unknown) => port.postMessage({ type: "result", id: m.id, error: e instanceof Error ? e.message : String(e) }),
    );
  });
  port.onDisconnect.addListener(() => {
    pool.dispose();
    if (--open === 0) void chrome.runtime.sendMessage({ type: "wtp:engine-idle" }).catch(() => undefined);
  });
});
