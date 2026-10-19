import type { ReactNode } from "react";

export interface GuideRow {
  title: string;
  body: ReactNode;
}

/** A landing page's guide: a heading, then a row per topic (its title beside the text). */
export function Guide({ title, lede, rows }: { title: string; lede?: string; rows: GuideRow[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="h-section">{title}</h2>
        {lede && <p className="section-lede">{lede}</p>}
      </div>
      <div className="guide">
        {rows.map((r) => (
          <div key={r.title} className="guide-row">
            <h3>{r.title}</h3>
            <div className="guide-text">{r.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
