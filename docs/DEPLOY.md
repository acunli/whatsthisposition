# Deploying what’sthisposition

The site is cheap to host: **all the heavy work (Stockfish, the photo reader) runs in visitors' browsers**. The server serves static files and two small API routes (a Chess.com/Lichess proxy and an optional photo reader), so any small machine or free tier is enough to start.

What a visitor downloads, roughly:
- **About 1 MB:** the app itself (JavaScript, CSS, the 3D hero).
- **1.8 MB:** the Stockfish engine, on the first analysis or review.
- **2.8 MB:** the opening book, on the first review.
- **0.9 MB:** the photo reader's weights, only when a photo is used.

So about **2–7 MB per new visitor**, and less on return visits (everything is cached). 10,000 visitors a month is roughly 30–60 GB of traffic.

## Option A: a small VPS with Docker (recommended)

**Cost:** about **€4–6 / $5–7 a month** for a 2 vCPU / 2–4 GB machine (e.g. Hetzner Cloud, DigitalOcean, Vultr, Linode). These include terabytes of traffic and have no rules against donation buttons. Check current prices on their sites.

1. Create the server (Ubuntu 24.04 LTS is fine) and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Point the domain at it: at your registrar (or Cloudflare DNS), add `A` (and `AAAA`) records for `whatsthisposition.com` and `www` with the server's IP.
3. Get the code and (optionally) settings:
   ```bash
   git clone https://github.com/acunli/whatsthisposition.git && cd whatsthisposition
   cp .env.example .env.local     # all optional; leave empty for a fully working site
   ```
4. Start it: the app plus [Caddy](https://caddyserver.com), which gets HTTPS certificates automatically:
   ```bash
   cd deploy && docker compose up -d --build
   ```
5. Visit https://whatsthisposition.com. To update later:
   ```bash
   git pull && cd deploy && docker compose up -d --build
   ```

The image runs as a non-root user and has a health check (`/api/health`). The rate limits for the API routes live in memory, which is exactly right for one server.

**Optional:** put Cloudflare's free plan in front for caching and DDoS protection (proxy the DNS records, SSL mode "Full (strict)").

## Option B: Vercel

**Cost:** the Hobby plan is free, but Vercel limits it to personal, **non-commercial** use. Read their fair-use terms before adding donations or sponsors; the Pro plan (about $20/month) has no such limit.

1. Import the GitHub repository at [vercel.com/new](https://vercel.com/new). The defaults are right (Next.js, `npm run build`).
2. Add environment variables in the project settings if you want them (see `.env.example`). None are required.
3. Add the domain under **Settings → Domains** and set the DNS records Vercel shows.

Notes:
- On serverless hosts each instance keeps its own rate-limit counts, so the limits are softer.
- The photo route has `maxDuration = 120` seconds for slow vision models. That only matters if you enable the cloud reader.

## Option C: any Node host

```bash
npm ci
NEXT_OUTPUT=standalone npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
PORT=3000 node .next/standalone/server.js
```

This works on Fly.io, Railway, Render and similar services (their small plans cost a few dollars a month; avoid free tiers that sleep, because the first visitor then waits).

## Environment variables

Everything is optional (see [`.env.example`](../.env.example)):

| Variable | What it does |
| --- | --- |
| `LICHESS_TOKEN` | Lets "Lichess username" list a player's games (Lichess only lists games to signed-in apps). Game links and Chess.com usernames work without it. Create a free token with no scopes. |
| `VISION_PROVIDER`, `ANTHROPIC_API_KEY`, `SOCLAAS_*` | The optional cloud photo reader, for angled photos of real boards. **Every photo is a paid API call**, so leave these empty on a public site unless you mean to pay; the route is limited to 6 photos per minute per visitor. Screenshots are always read on the device for free. |

## The domain

`whatsthisposition.com` is already the site's canonical address in the code (`src/lib/brand.ts`): page metadata, the sitemap, `robots.txt` and the social-preview image. Once it points at the server, nothing else needs changing. A `.com` costs about $10–15 a year at most registrars. Cloudflare Registrar sells at cost.

## Before launch

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass (CI runs them on every push).
- [ ] The domain resolves and HTTPS works (`curl -I https://whatsthisposition.com` shows `strict-transport-security`).
- [ ] `/api/health` returns `{"ok":true}`.
- [ ] Import a Chess.com username, review a game, open a position, read a screenshot.
- [ ] Share the link somewhere that shows previews to check the card (`/og.png`).
- [ ] Watch the server for a day: CPU and memory should stay low, since the work happens in browsers.

## Licence obligations when you host it

The site is GPL-3.0 and ships Stockfish (GPL-3.0) to browsers. When you host it:
- keep the source available: the credits page links to the repository;
- keep `/engine/COPYING.txt` served (it is copied in automatically);
- keep the attributions on `/credits`;
- the opening-book file is CC BY-SA 4.0 (it is derived from the Lichess broadcast database), so keep its credit.
