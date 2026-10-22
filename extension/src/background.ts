/**
 * The extension's service worker. It opens the hidden engine page (an offscreen document,
 * engine.html) when a card asks for it, and closes it when no card needs it. Stockfish runs
 * there rather than in the card, because the card lives inside Chess.com's page, where the
 * browser may not let it start workers.
 *
 * After an install, update or reload it also adds the page script to the Chess.com tabs that
 * are already open: until they reload, they have no script, or one cut off from the extension
 * (the old copy stops itself when the new one arrives), and no card would open in them.
 */
chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.query({ url: "https://www.chess.com/*" }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined || tab.discarded) continue;
      void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
    }
  });
});

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
