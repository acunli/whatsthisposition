import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { PageVeil } from "@/components/PageVeil";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { UsageTracker } from "@/components/UsageTracker";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/brand";
import { OG_IMAGE } from "@/lib/seo";
import { THEME_BG, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// One family for the whole site. Archivo's width axis gives the condensed display cut
// (headlines) and the normal cut (logo, body) from the same font. SIL Open Font License.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
  variable: "--font-archivo",
  display: "swap",
});

const TITLE = `${SITE_TAGLINE} · ${SITE_NAME}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "chess game review",
    "free chess game review",
    "chess.com game review",
    "lichess analysis",
    "chess analysis",
    "analyze chess game",
    "Stockfish",
    "brilliant move",
    "chess accuracy",
    "PGN analysis",
    "chess position from screenshot",
  ],
  authors: [{ name: "Ayushman Chaudhuri", url: "https://ayushman.rocks" }],
  creator: "Ayushman Chaudhuri",
  category: "games",
  alternates: { canonical: "/" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  // Search Console's HTML-tag check, when the owner sets the token in the project's env.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: THEME_BG.dark },
    { media: "(prefers-color-scheme: light)", color: THEME_BG.light },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Without JavaScript nothing starts the loading logo (see .veil-play), so it plays at once. */}
        <noscript dangerouslySetInnerHTML={{ __html: "<style>.veil-boot .veil-inner, .veil-boot .veil-inner * { animation-play-state: running !important; }</style>" }} />
        <PageVeil />
        {children}
        <SiteAnalytics />
        <UsageTracker />
      </body>
    </html>
  );
}
