/**
 * The extension's service worker. Its one job: open the hidden engine page (an
 * offscreen document, engine.html) when a card asks for it, and close it when no card
 * needs it. Stockfish runs there rather than in the card, because the card lives inside
 * Chess.com's page, where the browser may not let it start workers.
 */
const ENGINE_PAGE = "engine.html";
let opening: Promise<void> | null = null;

async function openEngine() {
  const url = chrome.runtime.getURL(ENGINE_PAGE);
  const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (open.length) return;
  opening ??= chrome.offscreen
    .createDocument({ url: ENGINE_PAGE, reasons: [chrome.offscreen.Reason.WORKERS], justification: "Runs Stockfish on this computer to review a finished Chess.com game." })
    .finally(() => {
      opening = null;
    });
  await opening;
}

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply) => {
  if (msg?.type === "wtp:engine-open") {
    openEngine().then(
      () => reply({ ok: true }),
      (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true; // the reply comes later
  }
  if (msg?.type === "wtp:engine-idle") void chrome.offscreen.closeDocument().catch(() => undefined);
  return false;
});
