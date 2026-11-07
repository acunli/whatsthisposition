/**
 * Light and dark themes. The site is light until the visitor picks dark with the toggle;
 * that choice is kept in localStorage and set as data-theme on <html> before the first
 * paint (THEME_SCRIPT, inlined in the root layout), so there is no flash.
 */
export type Theme = "light" | "dark";

export const THEME_KEY = "wtp-theme";
/** The theme a visitor gets until they pick one. */
export const DEFAULT_THEME: Theme = "light";
/** Fired on window when the visitor switches theme. */
export const THEME_EVENT = "wtp:theme";
/** Page backgrounds, for the browser's theme-color. */
export const THEME_BG: Record<Theme, string> = { dark: "#0c110f", light: "#f2f4f1" };

/**
 * Runs before the page paints: applies a stored choice, and gives the browser's bar the
 * matching colour (the theme-color tags come before it in <head>). Plain ES5, no dependencies.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}"),c=${JSON.stringify(THEME_BG)};if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c[t])}}catch(e){}`;

/** The theme in use: the visitor's choice, else the default. */
export function currentTheme(): Theme {
  const set = document.documentElement.getAttribute("data-theme");
  return set === "light" || set === "dark" ? set : DEFAULT_THEME;
}

export function setTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", THEME_BG[t]);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** For useSyncExternalStore: the theme changes only with the toggle. */
export function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}
