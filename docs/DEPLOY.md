# Deploying what’sthisposition

The site is cheap to host: **all the heavy work (Stockfish, the photo reader) runs in visitors' browsers**. The server serves static files and two small API routes (a Chess.com/Lichess proxy and an optional photo reader), so a free tier is enough to start.

What a visitor downloads, roughly:
- **About 1 MB:** the app itself (JavaScript, CSS, the 3D knight on the home page).
- **1.8 MB:** the Stockfish engine, on the first analysis or review.
- **2.8 MB:** the opening book, on the first review.
- **0.9 MB:** the photo reader's weights, only when a photo is used.

So about **2–7 MB per new visitor**, and less on return visits (everything is cached). 10,000 visitors a month is roughly 30–60 GB of traffic.

## Option A: Vercel (recommended, free)

The public site runs on Vercel's **Hobby plan**, which is free for personal, non-commercial projects. Vercel's [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage) say that *"asking for donations does not fall under commercial usage"*, so the "buy me a cookie" button is fine.

Hobby includes, each month (as of October 2026):

| Resource | Included | What uses it here |
| --- | --- | --- |
| Fast Data Transfer | 100 GB | Almost everything: pages, the engine, the opening book. About **15,000–35,000 new visitors** a month. |
| Function invocations | 1,000,000 | Only `/api/games` (one call per game list or game link) and `/api/recognize`. |
| Active CPU | 4 hours | The same two routes. They mostly wait on Chess.com or Lichess, which doesn't count. |

The **Usage** tab in the Vercel dashboard shows where the site stands. If it ever outgrows Hobby, move up to Pro (about $20 a month) or use Option B.

### Go live on a free address

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import `acunli/whatsthisposition`. Name the project `whatsthisposition` to get `whatsthisposition.vercel.app`, if that name is free.
3. Leave the build settings alone: Vercel detects Next.js, and `npm install` copies the Stockfish files in by itself. No environment variables are needed (the optional ones are listed [below](#environment-variables)).
4. Select **Deploy**. A minute or two later the site is live at `https://<project>.vercel.app`.

From then on, **every push to `main` deploys to production**, and every pull request gets its own preview address. Preview deployments aren't indexed by search engines.

Check it: `https://<project>.vercel.app/api/health` returns `{"ok":true}`; then import a Chess.com username and review a game.

### Add the domain later

Until a domain is added, the site uses its `vercel.app` address in page metadata, share previews and the sitemap, so links shared before the domain exists still work. When you buy `whatsthisposition.com`:

1. Buy it at any registrar. A `.com` costs about $10–15 a year; Cloudflare Registrar sells at cost.
2. In Vercel, open the project's **Settings → Domains** and add `whatsthisposition.com`. Accept the suggestion to redirect `www.whatsthisposition.com` to it.
3. At the registrar, create the DNS records Vercel shows (usually an `A` record for the bare domain and a `CNAME` for `www`). Use the exact values from the dashboard. HTTPS certificates are issued automatically.
4. **Redeploy once** (Deployments → the latest one → Redeploy, or push any commit). The site's address is read at build time, so this switches the metadata and the sitemap to the new domain.

Afterwards, production builds redirect the `vercel.app` addresses to the domain (`next.config.ts`), so search engines see each page at one address. Preview deployments keep their own addresses.

### Notes on Vercel

- **Rate limits** live in memory, so each function instance keeps its own count. That makes the limits softer than on one server, but still useful against floods. Vercel overwrites `x-forwarded-for` with the visitor's real IP, so the limits can't be dodged with a forged header. If abuse ever shows up, the project's Firewall settings can add platform-level rules.
- **The photo route** (`/api/recognize`) allows 120 seconds, within Hobby's 300-second maximum, and accepts images up to 4 MB, under Vercel's 4.5 MB request limit. The browser crops and shrinks photos well below that. This only matters if you turn on the cloud reader, where **every photo is a paid API call**.
- **Region:** the two API routes run in one region (Washington, D.C., `iad1`, by default). Pages and files come from Vercel's worldwide CDN either way.
- **Headers:** the Content Security Policy, HSTS and cache headers come from `next.config.ts` and apply on Vercel as they do anywhere else.
- **Usage numbers:**
  - **The dashboard:** `/stats`, signed in with `STATS_PASSWORD`. Three views: **Overview** for any period (the last 24 or 48 hours, 7, 30 or 90 days, 12 months, all time, or two dates) drawn per hour, day, week or month against the period before: people, visits, page views, time on the site, new and returning people, reviews, analyses and every other counted use; a weekday-by-hour heatmap in your own time zone and the visitors' own clock; what people go on to do; channels and how well each converts; pages; countries, regions, cities and languages; devices, systems, browsers, window sizes, theme and processor threads; review times by depth; errors; page speed (Web Vitals, by device type); and the extension's store users and the GitHub stars, read once a day. **Retention** shows who comes back within a month. **Live** shows who's on the site now. Every period downloads as CSV (`/stats/export`). The counter needs a Redis database: `vercel integration add upstash/upstash-kv --plan free -m autoUpgrade=false` connects a free one, which stops counting at its monthly limit instead of upgrading (500,000 commands a month: a page load costs about a dozen, any other use about 8, a dashboard view about 60).
  - **The daily job** (`vercel.json` → `/api/cron/usage`, 00:10 UTC; Hobby allows one run a day) sums up finished days, reads the store listing and GitHub, and drops hourly sketches older than 35 days. Set `CRON_SECRET` in the project to let only Vercel call it (without it the job is still harmless: it is idempotent and rate-limited).
  - **Vercel Web Analytics** adds referrers, pages and devices. Turn it on under the project's **Analytics** tab (Hobby: 50,000 page views a month, one month of history).
  - **The extension's installs and weekly users** are in the Chrome Web Store developer dashboard.

### Search engines

The pages, the sitemap (`/sitemap.xml`) and `robots.txt` are ready; search engines still have to be told the site exists.

- **Google:** add the site in [Search Console](https://search.google.com/search-console). A **Domain** property is verified with a DNS `TXT` record at the registrar; a **URL prefix** property (`https://www.whatsthisposition.com/`) can use the HTML tag instead: put the tag's `content` value in the `GOOGLE_SITE_VERIFICATION` environment variable and redeploy. Then, under **Sitemaps**, submit `sitemap.xml`, and use **URL inspection → Request indexing** for the home page. Verifying also lets the Chrome Web Store show the site as the extension's official URL.
- **Bing** (and DuckDuckGo, Yahoo and others that use Bing's index): [Bing Webmaster Tools](https://www.bing.com/webmasters) can import the site from Search Console. Every production deploy also pings Bing and the other [IndexNow](https://www.indexnow.org) engines with the sitemap's pages (`.github/workflows/indexnow.yml`, `npm run seo:indexnow`); the key is the file `public/<key>.txt`.

New pages go in `src/lib/landing.ts` (title, description, questions) with a folder under `src/app/`; the sitemap and the footer pick them up from there.

## Option B: a small VPS with Docker

**Cost:** about **€4–6 / $5–7 a month** for a 2 vCPU / 2–4 GB machine (e.g. Hetzner Cloud, DigitalOcean, Vultr, Linode), with terabytes of traffic included. Check current prices on their sites. Choose this if the site outgrows Vercel's free plan or you want a server of your own.

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

The image runs as a non-root user and has a health check (`/api/health`). The rate limits are exact on one server.

**On a different domain:** change it in `deploy/Caddyfile`, and pass the address to the build, for example `docker build --build-arg NEXT_PUBLIC_SITE_URL=https://chess.example.org .`

**Optional:** put Cloudflare's free plan in front for caching and DDoS protection (proxy the DNS records, SSL mode "Full (strict)"). Then set `CLIENT_IP_HEADER=cf-connecting-ip`, and allow only Cloudflare's addresses through the server's firewall, so the rate limits see real visitors.

## Option C: any Node host

```bash
npm ci
NEXT_OUTPUT=standalone npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
PORT=3000 node .next/standalone/server.js
```

This works on Fly.io, Railway, Render and similar services. Their small plans cost a few dollars a month. Avoid free tiers that sleep, because the first visitor then waits.

## Environment variables

Everything is optional (see [`.env.example`](../.env.example)):

| Variable | What it does |
| --- | --- |
| `LICHESS_TOKEN` | Raises Lichess's rate limit for "Lichess username" imports. Not needed: usernames, game links and Chess.com all work without it. A free personal token with no scopes is enough. |
| `NEXT_PUBLIC_SITE_URL` | The public address for metadata and the sitemap. Not needed on Vercel (it follows the production domain) or on whatsthisposition.com. Read at build time. |
| `GOOGLE_SITE_VERIFICATION` | The token from Google Search Console's HTML-tag check (only the `content` value). Read at build time. |
| `CLIENT_IP_HEADER` | Behind a proxy other than Vercel or Caddy, the header with the visitor's real IP (e.g. `cf-connecting-ip`), for the rate limits. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | The usage counter's database (Upstash Redis from the Vercel Marketplace sets these when it's connected to the project). Without them nothing is counted. |
| `STATS_PASSWORD` | Turns on the usage dashboard at `/stats` (HTTP sign-in: any user name, this password). Without it `/stats` doesn't exist. |
| `USAGE_SECRET` | Optional: the key for the monthly visitor hashes (defaults to the database token). |
| `CRON_SECRET` | Optional: Vercel sends it with the daily usage job (`/api/cron/usage`), which then refuses other callers. |
| `VISION_PROVIDER`, `ANTHROPIC_API_KEY`, `SOCLAAS_*` | The optional cloud photo reader, for angled photos of real boards. **Every photo is a paid API call**, so leave these empty on a public site unless you mean to pay; the route is limited to 6 photos per minute per visitor. Screenshots are always read on the device for free. |

On Vercel, set these under the project's **Settings → Environment Variables**, then redeploy.

## How the site's address is chosen

`SITE_URL` in `src/lib/brand.ts` feeds the page metadata, the canonical link, the sitemap, `robots.txt` and the social-preview image. It is, in order:
1. `NEXT_PUBLIC_SITE_URL`, if set;
2. on Vercel, the project's production domain (the custom domain once added, otherwise the `vercel.app` address);
3. otherwise `https://whatsthisposition.com`.

## Before launch

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass (CI runs them on every push).
- [ ] The site loads over HTTPS (`curl -I https://<address>` shows `strict-transport-security`).
- [ ] `/api/health` returns `{"ok":true}`.
- [ ] Import a Chess.com username, review a game, open a position, read a screenshot.
- [ ] Share the link somewhere that shows previews to check the card (`/og.png`).
- [ ] Add the site to Google Search Console and Bing Webmaster Tools and submit the sitemap (see "Search engines").
- [ ] After a few days, check the usage (Vercel's Usage tab, or the server's CPU and memory): it should stay low, since the work happens in browsers.

## Licence obligations when you host it

The site is GPL-3.0 and ships Stockfish (GPL-3.0) to browsers. When you host it:
- keep the source available: the credits page links to the repository;
- keep `/engine/COPYING.txt` served (it is copied in automatically);
- keep the attributions on `/credits`;
- the opening-book file is CC BY-SA 4.0 (it is derived from the Lichess broadcast database), so keep its credit.
