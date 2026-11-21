import type { CSSProperties } from "react";
import seen from "@/data/countries-seen.json";

/** The number the line states: the largest ten below the count, so "over" stays true. */
export const countriesClaim = (countries: number) => Math.max(0, Math.floor((countries - 1) / 10) * 10);

/**
 * "Used by chess players in over 90 countries", over the flags of the places the site has been
 * used from, sliding past. The flags are one picture (scripts/build-flags.mjs, from the usage
 * counter) repeated as a background that moves, so the page carries none of them; the strip
 * pauses under the pointer and stands still for visitors who ask for less motion.
 */
export function Flags() {
  const claim = countriesClaim(seen.countries);
  return (
    <div className="flags">
      <p className="flags-note">
        Used by chess players in <b>over {claim} countries</b>
      </p>
      <div className="flags-rail" aria-hidden>
        <div className="flags-track" style={{ "--flags": seen.flags, backgroundImage: `url(${seen.strip})` } as CSSProperties} />
      </div>
    </div>
  );
}
