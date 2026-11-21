import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import seen from "@/data/countries-seen.json";
import { countriesClaim } from "./Flags";

describe("the home page's flags", () => {
  it("has the strip the list names, one 64-unit box per flag (the CSS slides by that width)", () => {
    const file = join(process.cwd(), "public", seen.strip);
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    const open = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "";
    expect(open).toContain(`width="${seen.flags * 64}"`);
    expect(open).toContain('height="28"');
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(seen.flags);
    expect(seen.codes).toHaveLength(seen.flags);
    expect(new Set(seen.codes).size).toBe(seen.flags);
    expect(seen.countries).toBeLessThanOrEqual(seen.flags);
  });

  it("states a number the count is over", () => {
    expect(countriesClaim(96)).toBe(90);
    expect(countriesClaim(100)).toBe(90);
    expect(countriesClaim(101)).toBe(100);
    expect(countriesClaim(seen.countries)).toBeLessThan(seen.countries);
  });
});
