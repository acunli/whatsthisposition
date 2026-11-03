"use client";

import { useMemo, useState } from "react";
import type { Color } from "@/lib/chess/types";
import type { ClassifiedMove, PositionAnalysis } from "@/lib/review/classify";
import { gamePgn, type ParsedGame } from "@/lib/review/pgn";
import { packReview } from "@/lib/review/share";
import { headline, sides, summarize, type ShareSummary } from "@/lib/review/shareCard";
import { countUse, type UsageSource } from "@/lib/usage";

type State = { kind: "idle" } | { kind: "making" } | { kind: "copied"; url: string } | { kind: "shared"; url: string } | { kind: "error"; message: string };

/** Where a made link can be sent in one click: each site's own "post this link" address. */
const DESTINATIONS: [UsageSource<"share_to">, string, (url: string, text: string) => string][] = [
  ["reddit", "Reddit", (url, text) => `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`],
  ["x", "X", (url, text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`],
  ["whatsapp", "WhatsApp", (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`],
  ["facebook", "Facebook", (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
];

/** What the review is worth showing for, from the side it's seen from: a Brilliant or Great move, else a high accuracy. */
function boast(s: ShareSummary): string | null {
  const { me } = sides(s);
  if (s.moment) return `${me} found ${headline(s)}.`;
  const acc = s.accuracy[s.as];
  return acc != null && acc >= 85 ? `${me} played with ${acc.toFixed(1)} accuracy.` : null;
}

/**
 * "Share review": stores this finished review (/api/share) and copies its link, or opens the
 * phone's share sheet. The link opens the same review, without running the engine again, and
 * previews as a card with the key moment and both accuracies. This is the only time a game
 * leaves the browser, so the button says that it makes a public link. With a Brilliant or Great
 * move (or a high accuracy) on the reviewed side, it says so; once the link is made, it can be
 * posted to Reddit, X, WhatsApp or Facebook in one click.
 */
export function ShareReview({ game, moves, positions, accuracy, as, depth, opening }: { game: ParsedGame; moves: ClassifiedMove[]; positions: (PositionAnalysis | null)[]; accuracy: Record<Color, number | null> | null; as: Color; depth: number; opening?: string }) {
  // The link belongs to one review seen from one side: a re-run, another depth or a flip makes a new one.
  const key = `${depth}:${as}:${positions.length}:${positions.at(-1)?.depth ?? 0}`;
  const [shown, setShown] = useState<{ key: string; state: State }>({ key, state: { kind: "idle" } });
  const state: State = shown.key === key ? shown.state : { kind: "idle" };
  const setState = (s: State) => setShown({ key, state: s });
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  const summary = useMemo(() => summarize(game, moves, accuracy, as, opening), [game, moves, accuracy, as, opening]);
  const lead = boast(summary);
  const text = `${game.white} vs ${game.black}: ${headline(summary)}`;

  const share = async () => {
    try {
      let link = url?.key === key ? url.url : null;
      if (!link) {
        setState({ kind: "making" });
        const body = { pgn: gamePgn(game), as, depth, data: await packReview(positions, depth), summary };
        const res = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !out.url) throw new Error(out.error ?? "Couldn't make the link. Try again in a minute.");
        link = out.url;
        setUrl({ key, url: link });
        countUse("share");
      }
      // Phones get their share sheet (WhatsApp, Discord, …); computers get the link copied.
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: text, url: link });
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

  const made = state.kind === "copied" || state.kind === "shared" ? state.url : null;
  const label = summary.moment ? `Share the ${summary.moment.cls === "brilliant" ? "Brilliant" : "Great"} move` : "Share review";

  return (
    <div className={lead ? "rv-share rv-share-boast" : "rv-share"}>
      {lead && !made && <p className="rv-share-lead">{lead}</p>}
      <button className={lead ? "btn btn-sm btn-primary" : "btn btn-sm"} onClick={share} disabled={state.kind === "making"} title="Makes a public link to this game and its review">
        {state.kind === "making" ? "Making the link…" : state.kind === "copied" ? "Link copied" : label}
      </button>
      {made ? (
        <>
          <span className="small muted">
            Anyone with <a href={made}>the link</a> can see this game and its review.
          </span>
          <span className="rv-share-to">
            <span className="small muted">Post it to</span>
            {DESTINATIONS.map(([id, name, to]) => (
              <a key={id} className="chip chip-sm" href={to(made, text)} target="_blank" rel="noopener" onClick={() => countUse("share_to", id)}>
                {name}
              </a>
            ))}
            <button
              className="chip chip-sm"
              onClick={() => {
                countUse("share_to", "copy");
                void navigator.clipboard.writeText(made).catch(() => undefined);
              }}
            >
              Copy link
            </button>
          </span>
        </>
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
