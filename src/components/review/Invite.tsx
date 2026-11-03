"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { rememberedPlayer } from "@/lib/review/player";
import type { Site } from "@/lib/review/importers";
import { countUse } from "@/lib/usage";

/**
 * On a shared review (/r/…) or a published one (/games/…/review): the visitor's own games are one
 * username away. It goes to the home page with that player (?user=), which lists their games.
 */
export function Invite() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [site, setSite] = useState<Site>("chesscom");
  useEffect(() => {
    const me = rememberedPlayer();
    if (!me) return;
    /* eslint-disable react-hooks/set-state-in-effect -- read from this browser's storage after hydration */
    setName(me.user);
    setSite(me.site);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  return (
    <aside className="invite" aria-label="Review your own games">
      <p>Review your own games like this, free.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim().replace(/^@/, "");
          if (!n) return;
          countUse("invite", "shared");
          router.push(`/?user=${encodeURIComponent(n)}&site=${site}&ref=share`);
        }}
      >
        <select className="select select-sm" value={site} onChange={(e) => setSite(e.target.value as Site)} aria-label="Where you play">
          <option value="chesscom">Chess.com</option>
          <option value="lichess">Lichess</option>
        </select>
        <input className="input" placeholder="Your username" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your username" spellCheck={false} autoCapitalize="off" autoComplete="off" />
        <button className="btn btn-sm btn-primary" disabled={!name.trim()}>
          My games
        </button>
      </form>
    </aside>
  );
}
