/**
 * Lichess is opt-in. The extension asks for `lichess.org` only when its user turns Lichess on in
 * the toolbar popup (an optional host permission), so adding Lichess didn't make the browser
 * disable copies already installed for Chess.com until their users accepted a new permission.
 *
 * With the permission, the Lichess page script (lichess.js) is registered to run on every Lichess
 * page, and added to the Lichess tabs already open. Without it, the toolbar button still reviews
 * the game in the current Lichess tab: clicking it lets the extension into that one tab (activeTab).
 *
 * The permission can be given or taken back from the popup, from the browser's own extension
 * settings, or (Firefox) the add-on's Permissions tab; the background listens for each change.
 */
const ORIGINS = ["https://lichess.org/*"];
export const LICHESS: chrome.permissions.Permissions = { origins: ORIGINS };
const SCRIPT_ID = "lichess";

/** Adds the Lichess page script to the Lichess tabs already open (the old copy stops when the new one arrives). */
async function addToOpenTabs() {
  for (const tab of await chrome.tabs.query({ url: ORIGINS })) {
    if (tab.id === undefined || tab.discarded) continue;
    void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lichess.js"] }).catch(() => undefined);
  }
}

/**
 * Makes the Lichess page script's registration match the permission: registered, and added to
 * open Lichess tabs, when Lichess is on; removed when it's off. `toOpenTabs` adds it to the open
 * tabs even if it was registered already (after an install or update). Returns whether Lichess is on.
 */
export async function syncLichess(toOpenTabs = false): Promise<boolean> {
  const on = await chrome.permissions.contains(LICHESS);
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  try {
    if (on && !registered) {
      await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: ORIGINS, js: ["lichess.js"], runAt: "document_idle", persistAcrossSessions: true }]);
      await addToOpenTabs();
    } else if (on && toOpenTabs) await addToOpenTabs();
    else if (!on && registered) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // Another page of the extension (the popup, the background) made the same change first.
  }
  return on;
}

/** Keeps the registration in step with the permission, from the background. */
export function watchLichessAccess() {
  chrome.runtime.onStartup.addListener(() => void syncLichess());
  chrome.permissions.onAdded.addListener(() => void syncLichess());
  chrome.permissions.onRemoved.addListener(() => void syncLichess());
}
