import { CARD_SIZE, reviewCard } from "@/lib/server/reviewCard";
import { allGames, gameBySlug } from "@/lib/server/content";

export const alt = "The game's key moment on the board, with both players' accuracy and their labelled moves";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamicParams = false;

export function generateStaticParams() {
  return allGames().map((g) => ({ slug: g.slug }));
}

/** The game's card (src/lib/server/reviewCard.tsx), made when the site is built. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const g = gameBySlug((await params).slug);
  if (!g) return new Response("Not found", { status: 404 });
  return reviewCard(g.summary);
}
