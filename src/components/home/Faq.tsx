import { FAQ, type FaqItem } from "@/lib/faq";

/** Common questions, answered in a sentence or two. The same text is the page's FAQPage data. */
export function Faq({ items = FAQ, lede = "What people ask before they paste their first game." }: { items?: FaqItem[]; lede?: string }) {
  return (
    <section className="section faq" aria-labelledby="faq-title">
      <div className="section-head">
        <h2 className="h-section" id="faq-title">
          Questions
        </h2>
        <p className="section-lede">{lede}</p>
      </div>
      <div className="faq-list">
        {items.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
