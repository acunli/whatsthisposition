import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { PageVeil } from "@/components/PageVeil";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/brand";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["chess", "game review", "chess analysis", "Stockfish", "brilliant move", "chess explained", "opening book", "free", "open source"],
  authors: [{ name: "Ayushman Chaudhuri", url: "https://ayushman.rocks" }],
  alternates: { canonical: "/" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`,
    description: SITE_DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME}: chess games and positions, explained` }],
  },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`, description: SITE_DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#0c110f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <PageVeil />
        {children}
      </body>
    </html>
  );
}
