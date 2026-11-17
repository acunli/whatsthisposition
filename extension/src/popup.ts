/**
 * The toolbar button's popup: finds the finished game in the current Chess.com or Lichess tab and,
 * on "Review this game", opens the review card in the corner of that page. It also ticks the sites
 * where the card opens by itself when a game ends: Chess.com (on unless taken off) and Lichess
 * (which the extension may see only once its user allows it here: lichessAccess.ts). The button
 * works on both sites either way.
 */
import { chessComOn, type FindReply, type StatusReply } from "./card";
import { LICHESS, syncLichess } from "./lichessAccess";

const status = document.getElementById("status")!;
const button = document.getElementById("review") as HTMLButtonElement;
const chessComBox = document.getElementById("chesscom") as HTMLInputElement;
const watch = document.getElementById("watch")!;

void chrome.storage.local.get(["chesscom", "auto"]).then((v) => {
  chessComBox.checked = chessComOn(v);
});
chessComBox.addEventListener("change", () => {
  // The Chess.com tab hears of it (storage.onChanged) and starts or stops watching.
  void chrome.storage.local.set({ chesscom: chessComBox.checked }).then(() => setTimeout(() => void showWatch(), 100));
});

const lichessBox = document.getElementById("lichess") as HTMLInputElement;
void chrome.permissions.contains(LICHESS).then((on) => {
  lichessBox.checked = on;
});
lichessBox.addEventListener("change", () => {
  // The browser asks its user first; the request must start right here, in the click.
  const change = lichessBox.checked ? chrome.permissions.request(LICHESS) : chrome.permissions.remove(LICHESS).then(() => false);
  void change
    .catch(() => false)
    .then(() => syncLichess())
    .then((on) => {
      lichessBox.checked = on;
      void showWatch();
    });
});

/** What the page script is doing in this tab ("Watching this game…"), if it's a Chess.com or Lichess tab. */
async function showWatch() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { type: "wtp:status" })) as StatusReply;
    watch.textContent = r.on ? r.watching : "";
  } catch {
    // not a Chess.com or Lichess tab, or no page script there yet
  }
}
type Ask = FindReply | { ok: false; message: string; noPage: true };

const NO_PAGE: Ask = { ok: false, noPage: true, message: "Open one of your games on Chess.com or Lichess, then click here." };

/** Each site's page script (see reinject.ts). */
const SCRIPTS: [RegExp, string][] = [
  [/^https:\/\/www\.chess\.com\//, "content.js"],
  [/^https:\/\/lichess\.org\//, "lichess.js"],
];

async function ask(type: "wtp:find" | "wtp:open"): Promise<Ask> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return NO_PAGE;
  // The address is visible once the toolbar click grants access to this tab (activeTab).
  const script = tab.url === undefined ? undefined : (SCRIPTS.find(([site]) => site.test(tab.url!))?.[1] ?? null);
  if (script === null) return NO_PAGE;
  try {
    return (await chrome.tabs.sendMessage(tab.id, { type })) as FindReply;
  } catch {
    if (!script) return NO_PAGE;
    // A tab opened before the extension was installed or reloaded: add its script, then ask again.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script] });
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

void look().finally(() => void showWatch());
