import type { Metadata } from "next";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { PuzzleStudio } from "@/components/puzzles/PuzzleStudio";
import { SITE_NAME } from "@/lib/brand";

/**
 * Puzzles from the visitor's own games (src/lib/puzzles): several games are reviewed in
 * the browser, the mistakes are grouped into weaknesses, and each mistake with one clear
 * answer becomes a position to solve.
 */
export const metadata: Metadata = {
  title: { absolute: `Chess puzzles from your own games, free · ${SITE_NAME}` },
  description:
    "Pick several of your Chess.com or Lichess games, or paste their PGN. Stockfish reviews them in your browser, shows which mistakes you make most, and turns them into puzzles to practise on. Free, no account.",
  alternates: { canonical: "/puzzles" },
};

export default function PuzzlesPage() {
  return (
    <div className="shell">
      <PageTopbar back="Review a game" />
      <main>
        <PuzzleStudio />
      </main>
      <SiteFooter />
    </div>
  );
}
