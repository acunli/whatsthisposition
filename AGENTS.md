# Instructions for AI agents

1. Read [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) before doing anything. It covers what the project is, the owner's standing rules, the architecture, the decisions and the progress so far.
2. After every change, update `docs/PROJECT_CONTEXT.md` (the relevant sections plus a progress-log entry) in the same commit.
3. Commits are authored only by the owner. Never add `Co-Authored-By` trailers or "Generated with …" lines. Commit and push to `origin main` at each milestone.
4. Before committing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
5. Never commit `.env.local` or any API key.
