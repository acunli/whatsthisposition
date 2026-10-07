import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteLinks";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="topbar-brand" aria-label="Home">
          <Logo size={34} animate={false} />
        </Link>
      </header>
      <main className="prose status-page">
        <h1>No such page.</h1>
        <p>The address may be mistyped, or the page has moved. Everything lives on the home page: review a game, or open a single position.</p>
        <p>
          <Link className="btn btn-primary" href="/">
            Go to the home page
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
