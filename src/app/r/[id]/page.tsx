import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Studio } from "@/components/Studio";
import { SITE_NAME } from "@/lib/brand";
import { describe, headline } from "@/lib/review/shareCard";
import { sharedReview } from "./load";

type Props = { params: Promise<{ id: string }> };

/**
 * A shared review: the game opens straight into the review it was shared with (no engine run
 * needed), and its link shows a card with the players, the accuracies and the moment worth
 * seeing (./opengraph-image.tsx). Shared games are people's own, so they aren't indexed.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await sharedReview(id);
  if (!r) return { title: "Review not found", robots: { index: false, follow: false } };
  const s = r.summary;
  const title = `${s.white} vs ${s.black}: ${headline(s)}`;
  const description = describe(s);
  return {
    title: { absolute: `${title} · ${SITE_NAME}` },
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `/r/${id}` },
    openGraph: { type: "article", url: `/r/${id}`, siteName: SITE_NAME, title, description, locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedReviewPage({ params }: Props) {
  const { id } = await params;
  const r = await sharedReview(id);
  if (!r) notFound();
  return <Studio shared={{ pgn: r.pgn, as: r.as, depth: r.depth, data: r.data }} />;
}
