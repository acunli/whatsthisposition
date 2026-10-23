import type { Metadata } from "next";
import { Studio } from "@/components/Studio";

/**
 * The review page: the game picked on the home page (or a landing page), or handed over by the
 * extension. The game is kept in the browser tab, so the page has nothing of its own for search
 * engines; opened in a tab that never had a game, it goes to the home page.
 */
export const metadata: Metadata = {
  title: "Game review",
  robots: { index: false, follow: true },
  alternates: { canonical: "/review" },
};

export default function ReviewPage() {
  return <Studio />;
}
