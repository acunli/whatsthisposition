import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// This folder is the project root (so standalone output doesn't nest under a parent folder's lockfile).
const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content Security Policy. Everything is served from this origin: fonts are
 * self-hosted at build time, the engine and models are local files, and the only
 * outside requests (Chess.com, Lichess, the optional vision API) go through our
 * own API routes. Next.js needs inline scripts for hydration, WebAssembly needs
 * 'wasm-unsafe-eval' (Stockfish), and blob: covers photo previews.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const security = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const cache = (seconds: number) => [{ key: "Cache-Control", value: `public, max-age=${seconds}, stale-while-revalidate=${seconds * 7}` }];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `NEXT_OUTPUT=standalone npm run build` makes a self-contained server for Docker (see Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: root,
  turbopack: { root },
  async headers() {
    const prod = process.env.NODE_ENV === "production";
    return [
      // Security headers in production only: the dev server's hot reload needs eval.
      ...(prod ? [{ source: "/:path*", headers: security }] : []),
      // Static assets: versioned by the pinned packages and the build scripts; cache them.
      { source: "/engine/:file*", headers: cache(86400) },
      { source: "/pieces/:file*", headers: cache(604800) },
      { source: "/models/:file*", headers: cache(604800) },
      { source: "/data/:file*", headers: cache(86400) },
    ];
  },
};

export default nextConfig;
