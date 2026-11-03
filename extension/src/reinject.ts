/**
 * After an install, update or reload, adds the page script to the Chess.com tabs that are already
 * open: until they reload, they have no script, or one cut off from the extension (the old copy
 * stops itself when the new one arrives), and no card would open in them.
 */
export function reinjectOnInstall() {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.tabs.query({ url: "https://www.chess.com/*" }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined || tab.discarded) continue;
        void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
      }
    });
  });
}
