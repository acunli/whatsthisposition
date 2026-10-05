import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { START_FEN } from "@/lib/chess/fen";
import { PeekText } from "./Peek";

const html = (props: Parameters<typeof PeekText>[0]) => renderToStaticMarkup(createElement(PeekText, props));
const peeks = (s: string) => [...s.matchAll(/<span class="peek"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe("PeekText", () => {
  it("underlines each line's label, in text order", () => {
    const out = html({
      text: "Masters play 1.e4 (40%) or 1.d4 (35%).",
      lines: [
        { fen: START_FEN, pv: ["d2d4"], label: "1.d4" },
        { fen: START_FEN, pv: ["e2e4"], label: "1.e4" },
      ],
    });
    expect(peeks(out)).toEqual(["1.e4", "1.d4"]);
    expect(out.replace(/<[^>]+>/g, "")).toBe("Masters play 1.e4 (40%) or 1.d4 (35%).");
  });

  it("makes the whole sentence hoverable when a single line has no label in it", () => {
    expect(peeks(html({ text: "Good now.", line: { fen: START_FEN, pv: ["e2e4"] } }))).toEqual(["Good now."]);
  });

  it("renders plain text without lines (or with empty ones)", () => {
    expect(html({ text: "Quiet move." })).toBe("Quiet move.");
    expect(html({ text: "Quiet move.", line: { fen: START_FEN, pv: [] } })).toBe("Quiet move.");
  });
});
