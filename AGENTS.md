# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin: agents search, read, cite, and (when enabled and approved) write a local Zotero library through the loopback Local API (`127.0.0.1:23119/api`). It ships three Cordis bundle components — core, `dsh-zotero/library` (enabled), `dsh-zotero/scholarly` (disabled). Read `docs/product-model.md` before naming a component, surface, or scope.

## Repository map

| Path             | Ownership                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `src/`           | Host runtime: `ZoteroService` (`ctx.zotero`), HTTP transport, provider, `/zotero` command        |
| `src/local/`     | Local API domain pipelines behind the provider: search, browse, retrieve, export, changes, write |
| `src/library/`   | `dsh-zotero/library` component: `ctx.zoteroLibrary` panel endpoints and config                   |
| `src/scholarly/` | `dsh-zotero/scholarly` component: external search, fusion, fulltext, citations (7 tools)         |
| `src/tools/`     | The 23 host tools: 8 read + 15 write (write tools disabled by default)                           |
| `src/client/`    | Browser half bundled into `lib/client.js`: settings, 文献轨迹, 文献面板, tool cards              |
| `tests/`         | Seven declared lanes by ownership and verification level; rules in `tests/README.md`             |
| `docs/`          | Product and technical docs, maintained as zh/en pairs                                            |
| `scripts/`       | Build, pack verification, harness pinning, test lint, smoke probes                               |
| `lib/`           | Generated output from `tsc` and `esbuild`; never edited                                          |

## Sources of truth

- Product model, vocabulary, component boundaries: `docs/product-model.md`.
- Architecture, data flow, service layers: `docs/architecture.md` — read before changing services, jobs, the provider, or client surfaces.
- Tool contracts, schemas, errors: `docs/tools.md` — read before changing any tool.
- Configuration schemas and defaults: `docs/configuration.md`.
- Build, launch, debug, release: `docs/development.md`.
- Test lanes, fixtures, verification levels, guards: [tests/README.md](tests/README.md) — required before adding, moving, or refactoring tests or helpers.
- Upstream harness contracts: this repo is normally developed as a sibling checkout of `../deepseek-harness`; its docs and types outrank this file.

Keep `docs/x.md` and `docs/x.en.md` in lockstep. Tool-call examples in `README*.md` and the docs listed in `tests/host/doc-examples.spec.ts` are validated against the tools' parameter schemas.

## Commands

```sh
npm install                  # also builds lib/ through prepare
npx vitest run <spec>        # focused spec while iterating
npm run typecheck            # harness pin/lock checks + node, test, and client tsc
npm run build:client         # browser bundle only; required after src/client changes
npm test                     # test-lint guards + full vitest suite
npm run test:integration     # live read spec against Zotero on 127.0.0.1:23119
npm run format               # prettier --write; verify with format:check
npm run harness:check        # pin, lockfile, and upstream artifact freshness
npm run deps:check           # direct dependencies behind the registry; harness-owned ones excluded
npm run release:check        # full gate: format, strict harness, lint, typecheck, coverage, build, pack
```

Interactive launches (full plugin vs host-only HMR) and the opt-in write probe (`ZOTERO_WRITE_PROBE=1`) are documented in `docs/development.md`. Run `npm run link:local-harness` when the sibling harness is ahead of the registry.

## Invariants

- **Harness pin**: every `@deepseek-ai/dsh-*` in `dependencies`, `devDependencies`, and `overrides` is an exact version; `peerDependencies` and `engines.dsh` use `>=`. Never hand-edit versions — run `npm run harness:pin -- <ver>`, then `npm install --package-lock-only`. Vendored `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` floors must match the sibling's `vendor/<pkg>/package.json`. The browser bundle's third-party runtime dependencies mirror the sibling's `packages/client/*` declarations and move with the harness, never on their own; `npm run deps:check` excludes them.
- **Component authorization**: mounting `dsh-zotero/scholarly` is the only authorization for external requests, its 7 tools, and its prompt section. The core is request-driven: no external calls, background pollers, or load-time network I/O.
- **Write seam**: every write targets the personal library (`zotero://user/0/`) and passes through `ctx.zotero`: capability gate → `ctx.approval.request` → plan-review card. No bypass; a stale `writeConfirm: false` cannot opt out. Writes never retry — `committed-unverified` is reconciled, not retried. Shell commands that write to the Local API are intercepted by `src/shell-write-detector.ts`.
- **Client graph**: browser code may value-import only `src/client/**` and the pure modules allowlisted in `scripts/client-graph-authority.mjs`; never `@deepseek-ai/schemastery`, `src/config.ts`, `src/status-codec.ts`, or `src/typert.ts`. Keep `zod` external — the build refuses an inlined copy. `src/client/index.ts` must `await ctx.remote.$mount` before injecting on `remote.zotero`.
- **Zotero wire**: `src/search-text.ts` must keep mirroring Zotero's `normalizeForSearch`. A bare `/items/{key}/children` never returns annotations; request `?itemType=annotation`. Server-paged listings require a valid `Total-Results` header.
- **文献轨迹**: a read-only ledger projected from `ChatSnapshot`; it records read calls and exports, never writes or external results.
- **文献面板**: reaches the library only through `ctx.zoteroLibrary` / `ctx.remote.zotero` (`browse`, `search`, `item`, `childPage`, `export`, `write`). The web UI never dispatches model tools; `export` is read-only and shares the core export domain.
- **Teardown**: disposing the plugin does not abort in-flight requests; they settle on provider deadlines.

## Development rules

- Tests: one behaviour per spec; never `.only`, `.skip`, or `.todo` (use `.runIf`); synchronize on owned promises (`deferred()`), never sleeps; build fixtures with `tests/helpers/server/objects.ts`. `tests/README.md` owns the full rules and ratchets.
- Commits: `<type>(<scope>): <emoji> <subject>` — scope optional, lowercase type, imperative subject; body after a blank line, as bullet points explaining what and why.
- Never commit `dev.cordis.yml` or `dev-lib.cordis.yml`; both carry absolute paths. Edit the `.example` templates.

## Validation

- Iterating: focused spec + `npm run typecheck`; add `npm run build:client` for `src/client/**`.
- Behaviour changes: `npm test`.
- Cross-cutting, test-infrastructure, or release-bound: `npm run release:check`.
- Docs-only: `npm run format:check` and `npm run lint:test`.
- No PR workflow runs the suite; treat local validation as the gate. Report live checks you did not run.

## Safety

- **Loopback only**: `resolveConfig` rejects a non-loopback `baseUrl`; redirects are refused. External hosts exist only in `src/scholarly/transport/hosts.ts`.
- **Credentials**: the Zotero write grant lives in the harness credentials seam (`dsh-credentials`), never in plugin config. Never log, commit, or expose it.
- **Generated output**: `lib/` is produced by `tsc` and `esbuild`; rebuild instead of editing.
