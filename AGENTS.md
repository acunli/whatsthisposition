# Instructions for AI agents

These are for AI coding agents working on this repository (human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which shares rules 4 and 6).

1. Read [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) before doing anything. Start with **§0 "Pick up here"**: the current state, the last request and what was delivered, the next steps, how to verify, and gotchas. The rest covers what the project is, the owner's standing rules, the architecture, the decisions and the progress so far.
2. After every change, update `docs/PROJECT_CONTEXT.md` (the relevant sections plus a progress-log entry) in the same commit.
3. When working for the maintainer: commits are authored only by the maintainer. Never add `Co-Authored-By` trailers or "Generated with …" lines. Commit and push to `origin main` at each milestone.
4. Before committing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
5. Never commit `.env.local` or any API key.
6. Never tailor rules to one game or position: fix them in general terms and check them on games you haven't read yet. The owner wants changes checked on the Chess.com account **Ay7u**; the tools are in [`scripts/eval/README.md`](scripts/eval/README.md) (explanations, accuracy against Chess.com) and [`scripts/vision/README.md`](scripts/vision/README.md) (the photo reader).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
