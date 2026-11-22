# AGENTS.md

## Toolchain

- `mise.toml` pins **Node 22**, **pnpm 12.18.0**, **jactionlint 2.6.0** and **shellcheck 0.10.0**. Run `mise install` first and use `mise exec -- <cmd>` (or a `mise run` task); a globally installed pnpm/Node may differ.
- The verification gate is `mise run check`: `mise run check:workflows` → `pnpm generate:check` → `pnpm lint` → `pnpm typecheck` → `pnpm test:scripts` → `pnpm test` → `pnpm test:e2e` → `pnpm docker:build` → `pnpm docker:smoke`, strictly in that order (`mise.toml`). `check:workflows` runs `jactionlint .github/workflows/*.yml` with config in `.github/jactionlint.yaml`. Run the full check before finishing a change; CI runs the same command after `pnpm install --frozen-lockfile` and Playwright browser installation. The full check requires a running Docker daemon. Use `mise run check:fast` for the subset without generation, e2e and Docker.
- Focused checks: `mise exec -- pnpm --filter @app/backend test -- src/app.test.ts`, `mise exec -- pnpm --filter @app/backend typecheck`, `mise exec -- pnpm --filter @app/frontend typecheck`.

## Layout and wiring

- pnpm workspaces contain only `apps/backend` (`@app/backend`) and `apps/frontend` (`@app/frontend`); there is no shared package. Scope package commands with `pnpm --filter @app/<name> ...`.
- Backend: `src/index.ts` is the process entrypoint (`PORT`, default 3000) and passes optional `staticDir`, `apiPrefix` and `allowTestReset` (from `E2E_RESET === '1'`) to `createServer()`; `src/app.ts` exports `createServer()` and is the seam imported by tests. No HTTP framework. Routes: `GET/POST /meeting-types`, `GET /meeting-types/:id/slots`, `GET/POST /bookings`; legacy `GET /reserve` → `200 text/plain Reserved`; unknown paths → 404. With `staticDir` set, non-API GET/HEAD requests serve the built frontend and `/api/*` is normalized before routing. `now`, `staticDir`, `apiPrefix` and `allowTestReset` are internal options, not part of the public API — see `docs/adr/0003-api-contract.md` and `docs/adr/0004-slot-rules.md`.
- Backend is ESM with `module: NodeNext`: local TS imports must keep the `.js` extension (`./app.js`) even though the file is `.ts`. Do not "fix" it to an extensionless import.
- Backend tsconfigs are split: `tsconfig.json` is for typechecking and includes tests; `tsconfig.build.json` extends it and excludes `src/**/*.test.ts`. Keep that exclusion — otherwise compiled tests land in `dist/` and Vitest executes them twice.
- Frontend dev server is Vite on 5173. It proxies `/api` → `http://localhost:3000` and strips the `/api` prefix. `/guest` and `/owner` are real API-backed pages: the guest page lists meeting types, shows free slots and creates bookings; the owner page creates meeting types and lists bookings (refreshing on button click and on window focus/visibility). The landing page links to both; navigation is handled by `window.location.pathname`, without a router.
- shadcn/ui artifacts are `apps/frontend/components.json`, `src/components/ui/button.tsx`, `src/lib/utils.ts`. Dependencies `shadcn`, `cn`, `radix-ui`, `tw-animate-css`, `@fontsource-variable/geist` are deliberate (CSS imports in `src/index.css`), not unused cruft.
- The `@/*` alias is defined in both `vite.config.ts` and `tsconfig.json`; `tsconfig.json` intentionally omits `baseUrl` (deprecated in TypeScript 6).
- `Dockerfile` is multi-stage: Node 22 + Corepack/pnpm build the workspace, the runtime stage contains only `apps/backend/dist`, `apps/frontend/dist`, and minimal `package.json` files. Build and run with `mise run docker:build` and `mise run docker:run`; see `docs/adr/0002-docker-image.md`.
- The API contract source is `contracts/main.tsp`. `mise run generate` emits `contracts/openapi/openapi.json` and the TypeScript SDK in `apps/frontend/src/api/generated`.

## Generated artifacts

- `contracts/openapi/**` and `apps/frontend/src/api/generated/**` are generated. Never edit them manually.
- Change `contracts/main.tsp`, run `mise run generate`, and commit both the source and the regenerated output.
- `mise run check` regenerates and fails if the committed generated files differ.
- There is no server generator: the backend uses raw `node:http`, so handlers are maintained manually and covered by `apps/backend/src/contract.test.ts` plus HTTP tests.

## Tests and CI

- Vitest exists only in the backend. Tests start the server in-process on port 0 and close it in `afterEach` — no running backend, fixtures, or external services are required.
- `POST /__test__/reset` (through Vite: `/api/__test__/reset`) clears meeting types and bookings and returns `204`. It exists only when `createServer({ allowTestReset: true })` is used; `index.ts` enables it for `E2E_RESET=1`.
- Playwright e2e tests live in `e2e-tests/` with the root `playwright.config.ts`. They run against the real Vite dev server and a real backend, both started via `webServer` (the backend with `E2E_RESET=1`). Tests run with `workers: 1` and `fullyParallel: false`, and `e2e-tests/fixtures.ts` resets backend state before each test. They are part of `mise run check`; use `mise run test:e2e` for a focused run.
- `.github/workflows/hexlet-check.yml` is auto-generated: do not edit, rename, or delete it (see `.github/workflows/README.md`). Hexlet checks run on every push.
- `.github/workflows/ci.yml` mirrors the local gate on push and pull request; keep it in sync if check steps change. Docker build and container smoke are part of `mise run check`, so there is no separate Docker workflow. `.github/workflows/opencode.yml` runs the OpenCode GitHub agent on `/oc` and `/opencode` comments from the repository owner only, with `issues: write` and a short-lived `GH_TOKEN` so skills such as `to-spec` can publish issues. `.github/workflows/opencode-review.yml` reviews trusted same-repository pull requests on `pull_request`, reads `REVIEW.md` and `AGENTS.md` from the base branch, and publishes only `COMMENT` reviews. `.github/workflows/release-please.yml` runs on `main` and opens release PRs from Conventional Commits using the `RELEASE_PLEASE_TOKEN` PAT secret (fine-grained: Contents, Issues and Pull requests write); the repository does not enable PR creation by `GITHUB_TOKEN`. Rotate the PAT before expiry.
- Review criteria live in `REVIEW.md`; `.github/pull_request_template.md` records the evidence a PR must provide (checks, risk and rollback). Auto-review is evidence, not an approval: a human still decides whether to merge.

## Conventions

- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`. Scope is optional; use `api`, `backend`, `frontend`, `build`, `docker`, `ci`, or `deps` when useful.
- Every implementation commit references its driving GitHub issue in the subject, for example `feat(api): add TypeSpec contract and SDK (#20)`.
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`. Use `build(deps)` for dependency updates; `style` means code formatting, not UI styling.

## Agent skills

### Issue tracker

Issues and specs for this repo live in GitHub Issues (`znaeff/ai-for-developers-project-387`). See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to GitHub labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Render MCP

The repository's `opencode.json` configures the `render` MCP server at `https://mcp.render.com/mcp` and reads the bearer token from `RENDER_API_KEY`; no credential is stored in the repo. Create a key at `https://dashboard.render.com/u/settings#api-keys`, export `RENDER_API_KEY` in the environment that starts OpenCode (restart the background service if it was already running), and verify with `opencode mcp list`. Never commit the key — `.env*` is ignored except `.env.example`.
