import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Clash Display and Satoshi by Indian Type Foundry, via Fontshare (ITF Free Font License, free for commercial use).
const display = localFont({
  src: [
    { path: "../fonts/ClashDisplay-500.woff2", weight: "500" },
    { path: "../fonts/ClashDisplay-600.woff2", weight: "600" },
    { path: "../fonts/ClashDisplay-700.woff2", weight: "700" },
  ],
  variable: "--font-display",
  display: "swap",
});
const sans = localFont({
  src: [
    { path: "../fonts/Satoshi-400.woff2", weight: "400" },
    { path: "../fonts/Satoshi-500.woff2", weight: "500" },
    { path: "../fonts/Satoshi-700.woff2", weight: "700" },
    { path: "../fonts/Satoshi-900.woff2", weight: "900" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://whatsthisposition.com"),
  title: "WhatsThisPosition: see what the engine sees",
  description:
    "Snap any chess position. Threats, weaknesses, strengths and plans for both sides light up on the board, and every brilliant move is explained from the engine's lines.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
