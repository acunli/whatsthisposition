import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Studio } from "@/components/Studio";
import { SITE_NAME } from "@/lib/brand";
import { gameTitle } from "@/lib/content/text";
import { allGames, gameBySlug } from "@/lib/server/content";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return allGames().map((g) => ({ slug: g.slug }));
}

/** A reviewed game on the board: the app, opened straight into its finished review. The article (../page.tsx) is the page search engines get. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = gameBySlug((await params).slug);
  if (!g) return {};
  return {
    title: { absolute: `${gameTitle(g)}, move by move · ${SITE_NAME}` },
    robots: { index: false, follow: true },
    alternates: { canonical: `/games/${g.slug}` },
  };
}

export default async function GameReview({ params }: Props) {
  const g = gameBySlug((await params).slug);
  if (!g) notFound();
  return <Studio shared={{ pgn: g.pgn, as: g.as, depth: g.depth, data: g.data }} />;
}
