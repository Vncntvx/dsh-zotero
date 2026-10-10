# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin enabling agents to search, read, cite, and write to a local Zotero library (`127.0.0.1:23119/api`). Standing orders only; detailed docs live in `docs/`.

## Workspace

- Developed as a sibling checkout of `../deepseek-harness`. Upstream contracts outrank this file.
- Baseline harness pin is `dsh 0.2.1-alpha.2`. Use `npm run link:local-harness` when local types drift.

## Repository map

| Path          | Ownership                                                                            |
| ------------- | ------------------------------------------------------------------------------------ |
| `src/`        | Host runtime: Cordis service (`ZoteroService`), HTTP client, provider, tools, jobs   |
| `src/local/`  | Local API domain pipelines (search, browse, retrieve, export, changes, write)        |
| `src/tools/`  | 16 model tools (8 read + 8 write; write tools disabled by default)                   |
| `src/client/` | Browser half (settings page, Sources/Exports tabs, toolviews) → `lib/client.js`      |
| `tests/`      | Test suite organized into declared lanes (`tests/README.md`)                         |
| `docs/`       | Product and technical documentation, maintained in paired zh/en files                |
| `scripts/`    | Tooling for build, pack verification, harness pinning, test linting, and smoke tests |
| `lib/`        | Generated build output (`tsc` and `esbuild`) — never edit directly                   |

## Sources of truth

- Architecture & data flow: `docs/architecture.md` (read before changing service, jobs, or provider)
- Tool contracts & write boundary: `docs/tools.md` (read before modifying tools, schemas, or errors)
- Configuration & validation: `docs/configuration.md` (read before changing config schemas or defaults)
- Development & launch setup: `docs/development.md` (read for full-plugin vs HMR launch flows)
- Acceptance scenarios: `docs/scenarios.md` (walk matching G/S/R/E/C/N/W packs after behavioral changes)
- Test suite rules & fixtures: `tests/README.md` (read before adding or refactoring tests)
- Upstream harness contracts: sibling `../deepseek-harness/docs/`

Always maintain `docs/*.md` and `docs/*.en.md` pairs in lockstep.

## Commands

```sh
npm install                  # Install dependencies (runs build:prepare)
npx vitest run <spec>        # Focused test during iteration
npm run typecheck            # Typecheck node, test, and client projects
npm run build                # Full build: tsc -> lib/ and esbuild -> lib/client.js
npm run build:client         # Browser bundle only (lib/client.js)
npm test                     # Test lint guards + full vitest suite against mock server
npm run format               # Format codebase with Prettier (check via npm run format:check)
npm run release:check        # Format, harness pin, test lint, typecheck, coverage, build, pack
npm run harness:check        # Check harness version-pin consistency (pin via npm run harness:pin -- <ver>)
npm run test:integration     # Live Zotero integration tests (requires ZOTERO_INTEGRATION=1)
```

Refer to `docs/development.md` for interactive local launch workflows (full plugin vs host-only HMR).

## Architecture & Invariants

- **Harness pin**: `@deepseek-ai/dsh-*` in `devDependencies` and `overrides` pin the exact baseline; `peerDependencies` and `engines.dsh` require `>=`. Never edit versions manually; run `npm run harness:pin -- <ver>`. Keep vendored framework packages (`cordis`, `cosmokit`, `schemastery`) aligned with the upstream sibling.
- **Plugin lifecycle**: `src/index.ts` is a pure re-export of `ZoteroService`. Register tools, commands, system prompt sections, and providers via Cordis lifecycle effects. Typert manifests self-register via `ctx.inject(['typert'], ...)`.
- **Client graph isolation**: Browser code (`src/client/**`) may only import local surfaces allowlisted in `scripts/client-graph-authority.mjs` (`CLIENT_SAFE_LOCAL`). Never value-import host packages (`zod`, `schemastery`, host codecs, `src/config.ts`, `src/typert.ts`). Client entry self-mounts `remote.zotero` via `await ctx.remote.$mount(...)` before registering UI on a fiber declaring `remote.zotero`.
- **Write safety seam**: Write tools write to personal library `zotero://user/0/` only. Every write call passes through the `ctx.zotero` service seam: capability gate → `ctx.approval.request` → plan-review card. There is no `writeConfirm` and no bypass. Shell writes to the local API are intercepted via `src/shell-write-detector.ts`. Writes never retry.
- **Wire semantics**: `src/search-text.ts` must stay identical to Zotero's `normalizeForSearch`. Bare `GET .../items/{key}/children` yields only notes and attachments; annotations require `?itemType=annotation`. Paginated listings require a valid `Total-Results` header.
- **Sources tab**: Read tool-call events strictly via `ChatSnapshot` / session projection; never use deprecated `eventAt` / `snapshotEvents`.

## Development & Test Discipline

- **Lanes & ratchets**: Place every test in its declared lane under `tests/` (`tests/README.md`). Maximum spec length (`MAX_SPEC_LINES` in `scripts/test-lint.mjs`) and coverage ratchets (`vitest.config.ts`) only move in the tightening direction.
- **Test practices**: Never use `.only`, `.skip`, or `.todo` (use `.runIf` when gating). Synchronize on owned promises (`deferred()`), never on arbitrary sleep durations. Use canonical fixture builders from `tests/helpers/server/objects.ts`.
- **Commits**: Follow Conventional Commits: `<type>(<scope>): <subject>` (lowercase type, imperative subject, header < 72 chars). Body: blank line, followed by bullet points explaining what and why without hard wrapping.

## Validation

- **During iteration**: Run `npx vitest run <spec>` and `npm run typecheck` (add `npm run build:client` for browser changes).
- **Before completing behavioral changes**: Run `npm test` and verify relevant acceptance scenarios in `docs/scenarios.md`.
- **Before release or cross-cutting changes**: Run `npm run release:check`.

## Safety

- **Loopback isolation**: All HTTP traffic is strictly loopback (`127.0.0.1:23119`); `resolveConfig` rejects non-loopback addresses. No external calls, redirects, or background polling daemons.
- **Credentials**: Zotero write keys are durable capabilities stored in `$DSH_HOME/.credentials.yaml` (`0600`). Never log, commit, or expose them.
- **Generated code**: Never edit `lib/` directly. Never commit local debug overlays (`dev.cordis.yml`, `dev-lib.cordis.yml`); edit `.example` templates instead.
- **Lifecycle teardown**: Disposing the plugin does not abort in-flight HTTP requests; operations settle via provider deadlines.
