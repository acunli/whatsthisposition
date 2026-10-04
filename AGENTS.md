# Instructions for AI agents

1. Read [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) before doing anything. It covers what the project is, the owner's standing rules, the architecture, the decisions and the progress so far.
2. After every change, update `docs/PROJECT_CONTEXT.md` (the relevant sections plus a progress-log entry) in the same commit.
3. Commits are authored only by the owner. Never add `Co-Authored-By` trailers or "Generated with …" lines. Commit and push to `origin main` at each milestone.
4. Before committing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
5. Never commit `.env.local` or any API key.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
