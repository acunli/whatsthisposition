/**
 * Installing the site as an app (phones, where the Chrome extension can't go): the browser offers it
 * with a `beforeinstallprompt` event, which can fire before React has started, so INSTALL_SCRIPT
 * (inlined in the root layout) keeps it on `window` and says so with INSTALL_EVENT. Installed, the
 * app is in the phone's share sheet (manifest.ts).
 */
export const INSTALL_EVENT = "wtp:install";

export const INSTALL_SCRIPT = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__wtpInstall=e;dispatchEvent(new Event("${INSTALL_EVENT}"))});addEventListener("appinstalled",function(){window.__wtpInstall=null;dispatchEvent(new Event("${INSTALL_EVENT}"))})`;

/** The browser's offer to install the app (not in TypeScript's DOM types yet). */
export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** The offer kept so far, or null (none yet, already installed, or a browser that never offers). */
export function installPrompt(): InstallPrompt | null {
  return ((window as unknown as { __wtpInstall?: InstallPrompt | null }).__wtpInstall ?? null);
}
