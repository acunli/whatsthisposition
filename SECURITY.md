# Security

what’sthisposition has no accounts and stores nothing about its visitors; almost everything runs in the browser. The server side is small: static files, a Chess.com/Lichess proxy (`/api/games`), an optional photo reader (`/api/recognize`) and a health check.

## Reporting a vulnerability

Please **don't open a public issue**. Instead, use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a week.

Things that are especially worth reporting:

- a way to make the API routes reach hosts other than Chess.com, Lichess or the configured vision provider;
- a way around the rate limits that could run up the host's vision-API bill;
- anything that injects script into the page despite the Content Security Policy.

## For people hosting it

- Keep API keys in the host's environment settings or `.env.local`, never in the repository.
- Leave the cloud photo reader off (no key) unless you intend to pay for it; screenshots are read on the device for free.
- Production responses carry a strict Content Security Policy, HSTS and the usual hardening headers (`next.config.ts`).
- The rate limits key on the visitor's IP from `x-forwarded-for`, which Vercel and Caddy overwrite. Behind another proxy (Cloudflare, nginx), set `CLIENT_IP_HEADER` to the header it sets (for example `cf-connecting-ip`), and make sure visitors can't reach the server directly.
