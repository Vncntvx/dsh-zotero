# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin: agents search, read, cite, and (when enabled and approved) write a local Zotero library through the loopback Local API (`127.0.0.1:23119/api`). It ships four Cordis bundle components: core, `dsh-zotero/library` (enabled), `dsh-zotero/scholarly` (disabled), and `dsh-zotero/enrichment` (disabled). Read `docs/product-model.md` before naming a component, surface, or scope.

## Repository map

| Path              | Ownership                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`            | Host runtime: `ZoteroService` (`ctx.zotero`), HTTP transport, provider                                                                                                                                                        |
| `src/local/`      | Local API domain pipelines behind the provider: search, browse, retrieve, export, changes, write                                                                                                                              |
| `src/library/`    | `dsh-zotero/library` component: `ctx.zoteroLibrary` panel endpoints and config                                                                                                                                                |
| `src/scholarly/`  | `dsh-zotero/scholarly` component: external search, fusion, fulltext, citations (7 tools)                                                                                                                                      |
| `src/enrichment/` | `dsh-zotero/enrichment` component: MinerU transport, parse-once, artifact store, source index, local embedding models (`semantic/`, model downloader); target contract separates read-only lookup from user-submitted parsing |
| `src/tools/`      | The 23 host tools: 8 read + 15 write (write tools disabled by default)                                                                                                                                                        |
| `src/client/`     | Browser half bundled into `lib/client.js`: settings (including enrichment), 文献轨迹, 文献面板, tool cards                                                                                                                    |
| `tests/`          | Seven declared lanes by ownership and verification level; rules in `tests/README.md`                                                                                                                                          |
| `docs/`           | Product and technical docs, maintained as zh/en pairs                                                                                                                                                                         |
| `scripts/`        | Build, pack verification, harness pinning, test lint, smoke probes                                                                                                                                                            |
| `lib/`            | Generated output from `tsc` and `esbuild`; never edited                                                                                                                                                                       |

## Sources of truth

- Product model, vocabulary, component boundaries: `docs/product-model.md`.
- Architecture, data flow, service layers: `docs/architecture.md`: read before changing services, jobs, the provider, or client surfaces.
- Tool contracts, schemas, errors: `docs/tools.md`: read before changing any tool.
- Configuration schemas and defaults: `docs/configuration.md`.
- Build, launch, debug, release: `docs/development.md`.
- Test lanes, fixtures, verification levels, guards: [tests/README.md](tests/README.md): required before adding, moving, or refactoring tests or helpers.
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
npm run style:check          # client stylesheet guards against the token snapshot
npm run tokens:write         # refresh the token snapshot after a harness upgrade
npm run deps:check           # direct dependencies behind the registry; harness-owned ones excluded
npm run assets:semantic      # download/verify the pinned local embedding models into ~/.dsh/models
npm run eval:semantic        # recall/MRR evaluation of the hybrid ranker against a downloaded model (opt-in)
npm run release:check        # full gate: format, strict harness, lint, typecheck, coverage, build, pack
```

Interactive launches (full plugin vs host-only HMR) and the opt-in write probe (`ZOTERO_WRITE_PROBE=1`) are documented in `docs/development.md`. Run `npm run link:local-harness` when the sibling harness is ahead of the registry.

## Invariants

The enrichment rules below are the WP0 target contract. Implementation-status statements refer to the WP0 baseline `a3f4759` and do not certify parallel implementation work. At that baseline the seam exposes `{lookup, enhance}`, uploads default to `true`, and foreground ranking has no scope draining. WP1 must narrow the seam; WP2 must set the upload default to `false` and add user-submitted parsing jobs; WP7 must add foreground scopes and draining. Baseline semantic admission uses `routeBest - 0.02`, does not invoke the diagnostic probes, and has no cross-request vector cache; calibration and caching require WP6 and WP8 implementation and acceptance.

- **Harness pin**: every `@deepseek-ai/dsh-*` in `dependencies`, `devDependencies`, and `overrides` is an exact version; `peerDependencies` and `engines.dsh` use `>=`. Never hand-edit versions: run `npm run harness:pin -- <ver>`, then `npm install --package-lock-only`. Vendored `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` floors must match the sibling's `vendor/<pkg>/package.json`. The browser bundle's third-party runtime dependencies mirror the sibling's `packages/client/*` declarations and move with the harness, never on their own; `npm run deps:check` excludes them.
- **Component authorization**: mounting `dsh-zotero/scholarly` authorizes external scholarly retrieval, its 7 tools, and its prompt section. Mounting `dsh-zotero/enrichment` only makes parsing and model management available. `allowDocumentUpload` is a deployment gate whose target default is `false`; enabling it does not authorize any document. A MinerU parse additionally requires the user's explicit submission of one specific Zotero PDF attachment (child or top-level) or public PDF URL, with remote-action and session access checks. Ordinary `zotero_retrieve`, `scholarly_read`, PDF opening, settings saves, and service startup must never submit, resume, or upload a MinerU task. Local semantic ranking needs no MinerU call or upload permission, and parsing needs no semantic model. Model downloads are separate operations from the pinned mirrors through the component's own service; unmounting removes that capability. User-initiated URL PDF reading has separate `library.allowUrlPdfRead` authorization; neither it nor scholarly authorization grants upload permission. The core is request-driven: no external calls, background pollers, or load-time network I/O.
- **Enrichment seam**: enrichment depends on core, never the reverse. The target core holds two pure slots from `src/local/`: `FulltextEnhancer` exposes only `lookup`, with no `enhance`, raw document bytes, or upload operation; `EvidenceRanker` retains the core's complete BM25 ranker as the empty-slot value. Ordinary reads prefer valid Markdown for the same source and otherwise use the existing Zotero fulltext index or authorized local PDF extraction. A missing or stale artifact is a normal miss; permission, I/O, or protocol failures remain explicit. `lookup` must never download a document or contact MinerU: inspect the source index first, then stat a local candidate or revalidate a URL candidate with at most one token-free HEAD. Existing valid artifacts remain readable with uploads disabled. Parsing stays private to enrichment behind explicit user submission; a parsing failure must not switch mode or substitute local text as success. All MinerU transport, host table, credentials, artifact store, source index, embedding runtime, and model downloads live under `src/enrichment/`. The signed upload sends no headers and no token; `Authorization` is host-scoped to `mineru.net`; signed upload, result CDN, and cache HEAD never receive it. No legacy component, config, cache-format, or interface aliases or migrations are added.
- **Write seam**: every write targets the personal library (`zotero://user/0/`) and passes through `ctx.zotero`: capability gate → `ctx.approval.request` → plan-review card. No bypass; a stale `writeConfirm: false` cannot opt out. Writes never retry: `committed-unverified` is reconciled, not retried. Shell commands that write to the Local API are intercepted by `src/shell-write-detector.ts`.
- **Client graph**: browser code may value-import only `src/client/**` and the pure modules allowlisted in `scripts/client-graph-authority.mjs`; never `@deepseek-ai/schemastery`, `src/config.ts`, `src/status-codec.ts`, or `src/typert.ts`. Keep `zod` external: the build refuses an inlined copy. `src/client/index.ts` must `await ctx.remote.$mount` before injecting on `remote.zotero`.
- **Zotero wire**: `src/search-text.ts` must keep mirroring Zotero's `normalizeForSearch`. A bare `/items/{key}/children` never returns annotations; request `?itemType=annotation`. Server-paged listings require a valid `Total-Results` header, and collection and saved-search pages additionally require a valid `Last-Modified-Version`.
- **文献轨迹**: a read-only ledger projected from `ChatSnapshot`; it records read calls and exports, never writes or external results.
- **文献面板**: reaches the library only through `ctx.zoteroLibrary` / `ctx.remote.zotero` (`browse`, `collectionPath`, `search`, `item`, `childPage`, `export`, `write`, `readUrlPdf`, `releaseUrlPdf`). The web UI never dispatches model tools; `export` is read-only and shares the core export domain.
- **Client styling**: feature CSS consumes the host design system and defines none of it: no `--dsw-*` declaration, no literal colour outside a `mask-image`, no literal size outside the 16px `@media (pointer: coarse)` focus-zoom guard, and the reader's `--dsh-content-font-*` axis on every body-text surface. State borders are 1px, every full-round radius pairs `corner-shape: round`, and every transition is reduced under `prefers-reduced-motion: reduce`. Every control is an `@deepseek-ai/dsh-client-ui-primitives` `Button`; icon-only controls use the local `IconButton` adapter, which composes `Button`. A `className` may carry layout only, never geometry or colour; text-link actions use the single `src/client/components/link.module.css`. `npm run style:check` (spec: `tests/unit/style-guard.spec.ts`) enforces it against the token snapshot in `tests/fixtures/style-tokens.json`; a host upgrade means `npm run tokens:write`.
- **Teardown**: accepted foreground requests must settle on their original provider deadlines. The WP7 target is to capture committed ranking config, model target, and service generation before source I/O, release the read scope in `finally`, and retain model resources until accepted scopes and actual inference drain; a model switch or unmount must not release them early. The WP0 baseline has no such draining. The plugin's own background jobs are cancelled on teardown (`ZoteroJobRunner.killAll` for core/scholarly jobs). WP2 must put user-submitted parsing in session-owned `ctx.jobs`, without a fabricated tool call; explicit cancellation, session close, or component unmount must revoke the owned waiter and await actual cleanup before the job settles. Closing the UI releases observation only. Shared `ParseFlight` work aborts only when its last waiter leaves. At the WP0 baseline enrichment registers no parsing jobs, and teardown invokes model-download cancellation and embedder disposal. Owned parsing and download work must abort and finish cleanup on unmount; foreground model scopes drain separately.

## Development rules

- Tests: one behaviour per spec; never `.only`, `.skip`, or `.todo` (use `.runIf`); synchronize on owned promises (`deferred()`), never sleeps; build fixtures with `tests/helpers/server/objects.ts`. `tests/README.md` owns the full rules and ratchets.
- Commits: `<type>(<scope>): <emoji> <subject>`: scope optional, lowercase type, imperative subject; body after a blank line, as bullet points explaining what and why.
- Never commit `dev.cordis.yml` or `dev-lib.cordis.yml`; both carry absolute paths. Edit the `.example` templates.

## Validation

- Iterating: focused spec + `npm run typecheck`; add `npm run build:client` for `src/client/**`.
- Behaviour changes: `npm test`.
- Cross-cutting, test-infrastructure, or release-bound: `npm run release:check`.
- Docs-only: `npm run format:check` and `npm run lint:test`.
- No PR workflow runs the suite; treat local validation as the gate. Report live checks you did not run.

## Safety

- **Loopback only**: `resolveConfig` rejects a non-loopback `baseUrl`; redirects are refused. External hosts are governed by the scholarly allowlist (`src/scholarly/transport/hosts.ts`); PDF exceptions are explicit user reading under `library.allowUrlPdfRead` and the open-access PDF fulltext arm (`allowPublicPdf`), which may contact any public HTTP(S) host under the two-gate public-address check (lexical gate in `allowlist.ts`, connect-time public-DNS resolution and pinning in `network.ts`, ports 80/443 only, per-hop redirect re-validation). MinerU requests are the enrichment component's own boundary: the fixed API host is `mineru.net`; signed upload, result CDN, and cache HEAD URLs are dynamic untrusted public addresses under the same double gate, with the token never attached to them. Model downloads (`src/enrichment/model-download-client.ts`) are the component's other boundary: fixed seed hosts `hf-mirror.com` and `huggingface.co`, per-revision URLs, every redirect hop re-gated, content-length precheck, streaming byte cap, SHA-256 verification, and stall/deadline aborts; the host path supports no proxy.
- **Credentials**: the Zotero write grant lives in the harness credentials seam (`dsh-credentials`), never in plugin config. Never log, commit, or expose it. Scholarly API keys are credential references only: `src/scholarly/credentials.ts` resolves them through `ctx.credentials` per call, and a configured reference that does not resolve fails the call rather than degrading to anonymous access. The MinerU precise-API token is the same shape: `src/enrichment/credentials.ts` resolves its reference per parse in `pro` mode, and a configured reference that does not resolve fails closed with `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`.
- **Generated output**: `lib/` is produced by `tsc` and `esbuild`; rebuild instead of editing.
