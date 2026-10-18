"use client";

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";

/** The theme in use, kept in sync with the toggle and the system setting ("dark" on the server). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme, () => "dark");
}

/** Switches between the light and dark themes; the icon shows the one it switches to. */
export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button className="theme-toggle" onClick={() => setTheme(next)} aria-label={`Switch to the ${next} theme`} title={`Switch to the ${next} theme`}>
      {/* Both icons are drawn; CSS shows the right one before scripts run (see .theme-toggle). */}
      <svg viewBox="0 0 24 24" aria-hidden className="tt-sun">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden className="tt-moon">
        <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" />
      </svg>
    </button>
  );
}
