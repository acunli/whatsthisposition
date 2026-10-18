import { describe, expect, it } from "vitest";
import { THEME_BG, THEME_KEY, THEME_SCRIPT } from "./theme";
import { FAQ } from "./faq";
import { SITE_DESCRIPTION } from "./brand";

/** Runs the pre-paint script against a minimal stand-in for the page. */
function run(stored: string | null, throws = false) {
  const attrs: Record<string, string> = {};
  const metas = [{ content: "#0c110f" }, { content: "#f2f4f1" }].map((m) => ({ ...m, setAttribute: (_: string, v: string) => (m.content = v), m }));
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return k === THEME_KEY ? stored : null;
    },
  };
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    querySelectorAll: () => metas,
  };
  new Function("localStorage", "document", THEME_SCRIPT)(localStorage, document);
  return { theme: attrs["data-theme"], metas: metas.map((x) => x.m.content) };
}

describe("theme script", () => {
  it("applies a stored choice and the browser bar's colour before the first paint", () => {
    expect(run("light")).toEqual({ theme: "light", metas: [THEME_BG.light, THEME_BG.light] });
    expect(run("dark")).toEqual({ theme: "dark", metas: [THEME_BG.dark, THEME_BG.dark] });
  });

  it("leaves the system's choice alone without a valid stored one", () => {
    expect(run(null).theme).toBeUndefined();
    expect(run("purple").theme).toBeUndefined();
    expect(run(null).metas).toEqual(["#0c110f", "#f2f4f1"]);
  });

  it("never breaks the page when storage is blocked", () => {
    expect(() => run(null, true)).not.toThrow();
  });
});

describe("search metadata", () => {
  it("keeps the description short enough not to be cut off in results", () => {
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("has a question and an answer for every FAQ entry", () => {
    expect(FAQ.length).toBeGreaterThan(3);
    for (const { q, a } of FAQ) {
      expect(q.endsWith("?")).toBe(true);
      expect(a.length).toBeGreaterThan(40);
    }
  });
});
