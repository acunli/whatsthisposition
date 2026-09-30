import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Hanken_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://whatsthisposition.com"),
  title: "WhatsThisPosition: an X-ray for chess positions",
  description:
    "Snap or paste any chess position. See the threats, weaknesses, strengths and plans for both sides light up on the board, with Stockfish checking every claim.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
