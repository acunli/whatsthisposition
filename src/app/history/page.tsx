import type { Metadata } from "next";
import { PageTopbar } from "@/components/PageTopbar";
import { SiteFooter } from "@/components/SiteLinks";
import { HistoryView } from "@/components/history/HistoryView";

/**
 * The history of the games this browser has reviewed (src/lib/history). Nothing here is
 * sent to a server, and there is nothing for search engines: the page only shows what the
 * browser's own IndexedDB holds, and moves between devices only as a file the user
 * exports and imports.
 */
export const metadata: Metadata = {
  title: "History",
  robots: { index: false, follow: true },
  alternates: { canonical: "/history" },
};

export default function HistoryPage() {
  return (
    <div className="shell">
      <PageTopbar back="Review your own game" />
      <main>
        <HistoryView />
      </main>
      <SiteFooter />
    </div>
  );
}
