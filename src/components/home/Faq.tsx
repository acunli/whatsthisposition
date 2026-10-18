import { FAQ } from "@/lib/faq";

/** Common questions, answered in a sentence or two. The same text is the page's FAQPage data. */
export function Faq() {
  return (
    <section className="section faq" aria-labelledby="faq-title">
      <div className="section-head">
        <h2 className="h-section" id="faq-title">
          Questions
        </h2>
        <p className="section-lede">What people ask before they paste their first game.</p>
      </div>
      <div className="faq-list">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
