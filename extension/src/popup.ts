/**
 * The toolbar button's popup: finds the finished game in the current Chess.com tab and,
 * on "Review this game", opens the review card in the corner of that page.
 */
import type { FindReply } from "./content";

const status = document.getElementById("status")!;
const button = document.getElementById("review") as HTMLButtonElement;
type Ask = FindReply | { ok: false; message: string; noPage: true };

const NO_PAGE: Ask = { ok: false, noPage: true, message: "Open one of your games on Chess.com, then click here." };

async function ask(type: "wtp:find" | "wtp:open"): Promise<Ask> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return NO_PAGE;
  // The address is visible once the toolbar click grants access to this tab (activeTab).
  const onChessCom = tab.url === undefined ? null : /^https:\/\/www\.chess\.com\//.test(tab.url);
  if (onChessCom === false) return NO_PAGE;
  try {
    return (await chrome.tabs.sendMessage(tab.id, { type })) as FindReply;
  } catch {
    if (!onChessCom) return NO_PAGE;
    // A Chess.com tab opened before the extension was installed or reloaded: add its script, then ask again.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return (await chrome.tabs.sendMessage(tab.id, { type })) as FindReply;
  }
}

async function look() {
  button.disabled = true;
  button.textContent = "Review this game";
  status.textContent = "Looking for a game on this page…";
  const r = await ask("wtp:find").catch((): Ask => ({ ok: false, message: "Couldn't reach this tab. Refresh it, then click again." }));
  if (r.ok) {
    status.innerHTML = "";
    const p = document.createElement("p");
    p.className = "found";
    p.textContent = `${r.game.white} vs ${r.game.black}`;
    const sub = document.createElement("span");
    sub.textContent = r.game.message || r.game.result;
    p.append(sub);
    status.append(p);
    button.disabled = false;
  } else {
    status.textContent = r.message;
    if (!("noPage" in r)) {
      button.disabled = false;
      button.textContent = "Look again";
      button.dataset.retry = "1";
    }
  }
}

button.addEventListener("click", async () => {
  if (button.dataset.retry) {
    delete button.dataset.retry;
    return void look();
  }
  button.disabled = true;
  button.textContent = "Opening…";
  const r = await ask("wtp:open").catch((): Ask => ({ ok: false, message: "Couldn't reach this tab. Refresh it, then click again." }));
  if (r.ok) window.close();
  else {
    status.textContent = r.message;
    button.disabled = false;
    button.textContent = "Look again";
    button.dataset.retry = "1";
  }
});

void look();
