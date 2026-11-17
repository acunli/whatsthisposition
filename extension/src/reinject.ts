/**
 * After an install, update or reload, adds the page scripts to the Chess.com and Lichess tabs that
 * are already open: until they reload, they have no script, or one cut off from the extension (the
 * old copy stops itself when the new one arrives), and no card would open in them.
 */
const SCRIPTS: [string, string][] = [
  ["https://www.chess.com/*", "content.js"],
  ["https://lichess.org/*", "lichess.js"],
];

export function reinjectOnInstall() {
  chrome.runtime.onInstalled.addListener(() => {
    for (const [url, file] of SCRIPTS) {
      void chrome.tabs.query({ url }).then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined || tab.discarded) continue;
          void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] }).catch(() => undefined);
        }
      });
    }
  });
}
