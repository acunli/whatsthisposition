"use client";

import type { ReactNode } from "react";
import { EXTENSION_URL } from "@/lib/brand";
import { countUse, type UsageSource } from "@/lib/usage";

/** A puzzle piece, the browser's own sign for an extension. */
export function ExtensionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="ext-icon">
      <path d="M10 3.5a2 2 0 0 1 4 0V5h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V19H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z" />
    </svg>
  );
}

/** A link to the Chess.com extension on the Chrome Web Store; clicks are counted by where they came from. */
export function AddToChrome({ from, className, children, icon = true }: { from: UsageSource<"get_extension">; className?: string; children: ReactNode; icon?: boolean }) {
  return (
    <a className={className} href={EXTENSION_URL} target="_blank" rel="noopener" onClick={() => countUse("get_extension", from)}>
      {icon && <ExtensionIcon />}
      {children}
    </a>
  );
}
