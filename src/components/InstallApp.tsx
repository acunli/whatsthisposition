"use client";

import { useEffect, useState } from "react";
import { INSTALL_EVENT, installPrompt, type InstallPrompt } from "@/lib/install";
import { countUse } from "@/lib/usage";

/**
 * "Install the app": shown only where the browser offers to install the site (Chrome on Android,
 * mostly), so a game shared from the Chess.com or Lichess app opens straight in its review.
 */
export function InstallApp({ className }: { className?: string }) {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const read = () => setOffer(installPrompt());
    read();
    const installed = () => countUse("get_app", "installed");
    window.addEventListener(INSTALL_EVENT, read);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener(INSTALL_EVENT, read);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  if (!offer) return null;
  return (
    <button
      className={className}
      onClick={async () => {
        countUse("get_app", "hero");
        await offer.prompt();
        const { outcome } = await offer.userChoice;
        if (outcome === "accepted") setOffer(null);
      }}
      title="Then share a game from the Chess.com or Lichess app to review it here"
    >
      Install the app
    </button>
  );
}
