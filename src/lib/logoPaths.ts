/** The knight in the logo (mpchess set, GPL-3.0+), shared by the site's Logo and the browser extension. */
export const KNIGHT_BASE = "M6.5422 294.1782c1.0776 0 1.1247.8573 1.1247 1.4946H2.0688c0-.649.0465-1.4946 1.1241-1.4946z";
export const KNIGHT_HEAD =
  "M6.4242 293.7612H3.3096c.0424-1.2235 1.357-1.8739 1.4169-2.4641.0598-.5903-.208-.7423-.208-.7423s-.1836.7095-.4175.8545c-.234.145-.7784.2813-.7784.2813s-.382.3571-.6072.3323c-.2252-.025-.4179-.5822-.4179-.5822l.7646-1.261.3874-.894.3656-.413.1566-.6066.4401.5334c2.4231 0 2.9485 3.2354 2.0124 4.9617";

/** The static mark (lens, knight, ring, ticks, dot) as an SVG string, for pages without React. */
export function markSvg(size = 28): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="wtp-lens"><circle cx="24" cy="24" r="17"/></clipPath></defs><circle cx="24" cy="24" r="17" fill="#151c19"/><g clip-path="url(#wtp-lens)"><g transform="translate(5.6 4.4) scale(3.7)"><g transform="matrix(1.07361 0 0 1 -.233 -286.97)" fill="#f1ede2"><path d="${KNIGHT_BASE}"/><path d="${KNIGHT_HEAD}"/></g><circle cx="5.35" cy="4.05" r="0.34" fill="#151c19"/></g></g><circle cx="24" cy="24" r="20" fill="none" stroke="#ff7629" stroke-width="2.2"/><path d="M24 1.5v5M24 41.5v5M1.5 24h5M41.5 24h5" stroke="#ff7629" stroke-width="2.2" stroke-linecap="round"/><circle cx="38.2" cy="9.8" r="3.2" fill="#ff4b3e"/></svg>`;
}
