"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, FocusEvent, MouseEvent, TouchEvent } from "react";

type Props = Omit<ComponentProps<typeof NextLink>, "href" | "prefetch"> & { href: string };

/**
 * The site's internal link: next/link, but the page behind it is fetched when the visitor shows
 * they may follow it (the pointer over it, a touch, keyboard focus) instead of whenever it
 * scrolls into view. The click still lands on a page already loaded.
 *
 * Why: on Vercel each prefetch is a request for a prerendered page, and a region's CDN that
 * doesn't hold it reads it from the ISR cache, billed per 8 KB against the plan's ISR reads
 * (each deploy empties the CDN). Prefetching on view made every page view fetch the 10 to 20
 * pages it links to; in an hour of logs on 2026-11-20, three CDN misses in four were such
 * prefetches (a game's /review page, almost never opened).
 */
export default function Link({ href, onMouseEnter, onTouchStart, onFocus, ...rest }: Props) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return (
    <NextLink
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => {
        warm();
        onTouchStart?.(e);
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        warm();
        onFocus?.(e);
      }}
    />
  );
}
