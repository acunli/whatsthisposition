import { CARD_SIZE, reviewCard } from "@/lib/server/reviewCard";
import { sharedReview } from "./load";

export const alt = "A chess game review: the board at its key moment, both players' accuracy and their labelled moves";
export const size = CARD_SIZE;
export const contentType = "image/png";

/** The shared review's preview card (src/lib/server/reviewCard.tsx). */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const r = await sharedReview((await params).id);
  if (!r) return new Response("Not found", { status: 404 });
  return reviewCard(r.summary);
}
