import Link from "next/link";
import { SOURCE_URL } from "@/lib/brand";
import { Logo } from "./Logo";

/** The author's site. */
export const AUTHOR_URL = "https://ayushman.rocks";
/** Buy Me a Coffee page (slug "ayushmanc"). */
export const SUPPORT_URL = "https://www.buymeacoffee.com/ayushmanc";

export function SiteCredit({ className = "navlink" }: { className?: string }) {
  return (
    <a className={className} href={AUTHOR_URL} target="_blank" rel="noopener">
      Built by Ayushman
    </a>
  );
}

/**
 * The Buy Me a Coffee button, drawn here rather than by their script: the script
 * writes the button with document.writeln, which can't run after a page has loaded,
 * and it fetches fonts from Google. Same colours, emoji and wording as the official
 * button (yellow #FFDD00, black text, Arial, "buy me a cookie").
 */
export function SupportButton() {
  return (
    <a className="bmc" href={SUPPORT_URL} target="_blank" rel="noopener" aria-label="Buy me a cookie (opens Buy Me a Coffee)">
      <span className="bmc-emoji" aria-hidden>
        🍪
      </span>
      <span className="bmc-text">buy me a cookie</span>
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <Logo size={26} animate={false} />
        <p>
          Stockfish 19 runs in your browser. Games and photos stay on your device; nothing is stored.
        </p>
      </div>
      <nav className="footer-links" aria-label="Footer">
        <Link href="/credits">How it works, licences and privacy</Link>
        <a href={SOURCE_URL} target="_blank" rel="noopener">
          Source code
        </a>
        <a href={AUTHOR_URL} target="_blank" rel="noopener">
          Built by Ayushman
        </a>
        <a href={SUPPORT_URL} target="_blank" rel="noopener">
          Buy me a cookie
        </a>
      </nav>
    </footer>
  );
}
