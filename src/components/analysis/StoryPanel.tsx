"use client";

import { useEffect } from "react";
import type { Scene } from "@/lib/facts/tour";
import { EvidenceTag, sideName } from "./bits";

export const SCENE_MS = 5600;

interface Props {
  scenes: Scene[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  offRoot: boolean;
  onBackToRoot: () => void;
}

/** The coach's walkthrough: one finding at a time, animated on the board. */
export function StoryPanel({ scenes, index, onIndex, playing, onPlaying, offRoot, onBackToRoot }: Props) {
  const s = scenes[index];

  useEffect(() => {
    if (!playing || offRoot || scenes.length < 2) return;
    const t = setTimeout(() => {
      if (index + 1 >= scenes.length) onPlaying(false);
      else onIndex(index + 1);
    }, SCENE_MS);
    return () => clearTimeout(t);
  }, [playing, index, scenes.length, onIndex, onPlaying, offRoot]);

  if (!s) return <div className="tour muted">Nothing stands out yet. Try the Layers tab.</div>;
  const tone = s.polarity === "strength" ? "t-opportunity" : "t-danger";

  return (
    <div className="tour">
      <div className="tour-head">
        <span className="eyebrow">Guided tour</span>
        <span className="tour-count">
          {String(index + 1).padStart(2, "0")}
          <span> / {String(scenes.length).padStart(2, "0")}</span>
        </span>
      </div>
      {offRoot ? (
        <p className="small muted">
          The tour describes the starting position.{" "}
          <button className="linkish" onClick={onBackToRoot}>
            Back to it
          </button>
        </p>
      ) : (
        <div key={s.id} className={`tour-card ${tone}`}>
          <span className="tour-kind">
            <span className={`side-dot side-${s.side}`} aria-hidden />
            {s.kicker ?? `${sideName(s.side)} · ${s.polarity}`}
          </span>
          <h3 className="tour-label">{s.label}</h3>
          <p className="tour-text">{s.fact.title}</p>
          {s.fact.detail && <p className="tour-detail">{s.fact.detail}</p>}
          <div>
            <EvidenceTag e={s.fact.evidence} />
          </div>
        </div>
      )}
      <div className="tour-nav">
        <button className="btn btn-sm" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous finding">
          ◀
        </button>
        <div className="tour-bars" role="tablist" aria-label="Findings">
          {scenes.map((sc, i) => (
            <button
              key={sc.id}
              aria-current={i === index}
              aria-label={sc.label}
              className={`${i < index ? "done" : ""} ${i === index && playing ? "playing" : ""}`}
              style={{ ["--dur" as string]: `${SCENE_MS}ms` }}
              onClick={() => {
                onIndex(i);
                onPlaying(false);
              }}
            />
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause tour" : "Play tour"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="btn btn-sm" onClick={() => onIndex(Math.min(scenes.length - 1, index + 1))} disabled={index >= scenes.length - 1} aria-label="Next finding">
          ▶▶
        </button>
      </div>
    </div>
  );
}
