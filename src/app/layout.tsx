import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { PageVeil } from "@/components/PageVeil";
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
  metadataBase: new URL("https://whatsthisposition.com"),
  title: "WhatsThisPosition: see what the engine sees",
  description:
    "Review any chess game move by move, with every label explained from Stockfish's own lines, or open a single position and see its threats, weaknesses and plans on the board.",
  icons: { icon: "/icon.svg" },
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
