import Link from "next/link";
import { SITE_NAME } from "@/lib/brand";
import { Logo } from "./Logo";
import { SiteCredit, SupportButton } from "./SiteLinks";
import { ThemeToggle } from "./ThemeToggle";

/** The top bar of the pages outside the app (how it works, the extension, the labels). */
export function PageTopbar({ back = "Back to the board" }: { back?: string }) {
  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand" aria-label={`${SITE_NAME} home`}>
        <Logo size={34} animate={false} />
      </Link>
      <nav className="topbar-nav" aria-label="Site">
        <Link className="navlink navlink-wide" href="/">
          {back}
        </Link>
        <SiteCredit className="navlink navlink-wide" />
        <ThemeToggle />
        <SupportButton />
      </nav>
    </header>
  );
}
