"use client";

import { useState } from "react";
import type { Color } from "@/lib/chess/types";
import type { ClassifiedMove, PositionAnalysis } from "@/lib/review/classify";
import { gamePgn, type ParsedGame } from "@/lib/review/pgn";
import { packReview } from "@/lib/review/share";
import { headline, summarize } from "@/lib/review/shareCard";
import { countUse } from "@/lib/usage";

type State = { kind: "idle" } | { kind: "making" } | { kind: "copied"; url: string } | { kind: "shared"; url: string } | { kind: "error"; message: string };

/**
 * "Share review": stores this finished review (/api/share) and copies its link, or opens the
 * phone's share sheet. The link opens the same review, without running the engine again, and
 * previews as a card with the key moment and both accuracies. This is the only time a game
 * leaves the browser, so the button says that it makes a public link.
 */
export function ShareReview({ game, moves, positions, accuracy, as, depth, opening }: { game: ParsedGame; moves: ClassifiedMove[]; positions: (PositionAnalysis | null)[]; accuracy: Record<Color, number | null> | null; as: Color; depth: number; opening?: string }) {
  // The link belongs to one review seen from one side: a re-run, another depth or a flip makes a new one.
  const key = `${depth}:${as}:${positions.length}:${positions.at(-1)?.depth ?? 0}`;
  const [shown, setShown] = useState<{ key: string; state: State }>({ key, state: { kind: "idle" } });
  const state: State = shown.key === key ? shown.state : { kind: "idle" };
  const setState = (s: State) => setShown({ key, state: s });
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);

  const share = async () => {
    try {
      let link = url?.key === key ? url.url : null;
      if (!link) {
        setState({ kind: "making" });
        const body = { pgn: gamePgn(game), as, depth, data: await packReview(positions, depth), summary: summarize(game, moves, accuracy, as, opening) };
        const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !out.url) throw new Error(out.error ?? "Couldn't make the link. Try again in a minute.");
        link = out.url;
        setUrl({ key, url: link });
        countUse("share");
      }
      const summary = summarize(game, moves, accuracy, as, opening);
      // Phones get their share sheet (WhatsApp, Discord, …); computers get the link copied.
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${game.white} vs ${game.black}: ${headline(summary)}`, url: link });
        setState({ kind: "shared", url: link });
        return;
      }
      await navigator.clipboard.writeText(link).catch(() => undefined);
      setState({ kind: "copied", url: link });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return setState({ kind: "idle" }); // share sheet closed
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't make the link." });
    }
  };

  return (
    <div className="rv-share">
      <button className="btn btn-sm" onClick={share} disabled={state.kind === "making"} title="Makes a public link to this game and its review">
        {state.kind === "making" ? "Making the link…" : state.kind === "copied" ? "Link copied" : "Share review"}
      </button>
      {state.kind === "copied" || state.kind === "shared" ? (
        <span className="small muted">
          Anyone with <a href={state.url}>the link</a> can see this game and its review.
        </span>
      ) : state.kind === "error" ? (
        <span className="small rv-share-error" role="alert">
          {state.message}
        </span>
      ) : (
        <span className="small muted">A public link that opens this review, with a preview card.</span>
      )}
    </div>
  );
}
