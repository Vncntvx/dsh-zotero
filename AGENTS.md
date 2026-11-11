# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin: agents search, read, cite, and (when enabled and approved) write a local Zotero library through the loopback Local API (`127.0.0.1:23119/api`). It ships four Cordis bundle components — core, `dsh-zotero/library` (on), `dsh-zotero/scholarly` (off), `dsh-zotero/enrichment` (off). Read `docs/product-model.md` before naming a component, surface, or scope; `docs/development.md` holds the current WP0–WP11 implementation-status table.

## Repository map

| Path                                            | Ownership                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                          | Host runtime: `ZoteroService` (`ctx.zotero`), HTTP transport, provider, config, error vocabulary                                   |
| `src/local/`                                    | Local API domain pipelines behind the provider: search, browse, retrieve, export, changes, write                                   |
| `src/library/`                                  | `dsh-zotero/library` component: `ctx.zoteroLibrary` panel endpoints and config                                                     |
| `src/scholarly/`                                | `dsh-zotero/scholarly` component: external search, fusion, fulltext, citations (7 tools)                                           |
| `src/enrichment/`                               | `dsh-zotero/enrichment` component: MinerU transport, parse-once, artifact store, source index, model download, `semantic/` ranking |
| `src/tools/`                                    | The 23 host tools: 8 read + 15 write (write tools disabled by default)                                                             |
| `src/client/`                                   | Browser half bundled into `lib/client.js`: settings, 文献轨迹, 文献面板, tool cards                                                |
| `src/transport/`, `src/skills/`, `src/sources/` | Shared network gates, research skills, 文献轨迹 ledger and projections                                                             |
| `tests/`                                        | Seven lanes by ownership and verification level; rules in `tests/README.md`                                                        |
| `docs/`                                         | Product and technical docs, maintained as zh/en pairs                                                                              |
| `scripts/`                                      | Build, pack verification, harness pinning, test lint, style guard, smoke probes                                                    |
| `lib/`                                          | Generated output from `tsc` and `esbuild`; never edited                                                                            |

## Sources of truth

- Product model, vocabulary, component boundaries: `docs/product-model.md`.
- Architecture, data flow, service layers: `docs/architecture.md` — read before changing services, jobs, the provider, or client surfaces.
- Tool contracts, schemas, errors: `docs/tools.md` — read before changing any tool.
- Configuration schemas and defaults: `docs/configuration.md`.
- Build, launch, debug, release, WP status: `docs/development.md`.
- Test lanes, fixtures, verification levels, guards: [tests/README.md](tests/README.md) — required before adding, moving, or refactoring tests or helpers.
- Upstream harness contracts: this repo is normally developed as a sibling checkout of `../deepseek-harness`; its docs and types outrank this file.

Keep `docs/x.md` and `docs/x.en.md` in lockstep. `tests/host/doc-coverage.spec.ts` checks the pairs and the counts they state; `tests/host/doc-examples.spec.ts` validates every documented tool call against the tools' parameter schemas.

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
npm run release:check        # full gate: format, strict harness, lint, typecheck, coverage, build, pack
```

Interactive launches (full plugin vs host-only HMR) are in `docs/development.md`. The live write probe has no script: `ZOTERO_INTEGRATION=1 ZOTERO_WRITE_PROBE=1 npx vitest run tests/integration/write-probe.integration.spec.ts` (see `tests/README.md`). Run `npm run link:local-harness` when the sibling harness is ahead of the registry.

## Architecture and invariants

- **Harness pin**: every `@deepseek-ai/dsh-*` in `dependencies`, `devDependencies`, and `overrides` is an exact version; `peerDependencies` and `engines.dsh` use `>=`. Never hand-edit versions: run `npm run harness:pin -- <ver>`, then `npm install --package-lock-only`. Vendored `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` floors must match the sibling's `vendor/<pkg>/package.json`. The browser bundle's third-party runtime dependencies mirror the sibling's `packages/client/*` and move with the harness, never on their own; `npm run deps:check` excludes them.
- **Component authorization**: mounting `dsh-zotero/scholarly` authorizes external scholarly retrieval, its 7 tools, and its prompt section; mounting `dsh-zotero/enrichment` only makes parsing, artifact reuse, and model management available. `allowDocumentUpload` (default `false`) is a deployment gate — enabling it authorizes no document. A MinerU parse additionally requires the user's explicit submission of one specific Zotero PDF attachment or public PDF URL, with remote-action and session access checks. Ordinary `zotero_retrieve`, `scholarly_read`, PDF opening, settings saves, and service startup must never submit, resume, or upload a MinerU task. Local semantic ranking needs no MinerU call or upload permission, and parsing needs no semantic model. `library.allowUrlPdfRead` (default `false`) separately gates user-initiated URL PDF reading; neither it nor scholarly authorization grants upload permission.
- **Enrichment seam**: enrichment depends on core, never the reverse. The core holds two pure slots from `src/local/`: `FulltextEnhancer` exposes only `lookup` — no document bytes, no upload, no task creation — and `EvidenceRanker` holds the core's complete BM25 ranker as its empty-slot value. `lookup` may stat a local candidate or revalidate a URL candidate with one token-free HEAD; it never downloads a document or contacts MinerU. A missing or stale artifact is a normal miss; permission, I/O, and protocol failures stay explicit. Parsing stays private to enrichment behind explicit user submission, and a parse failure never substitutes local text as success.
- **Semantic ranking fails closed**: no repository test loads a model or uses the network; model measurement is a manual procedure over supplied embeddings. each catalog tier's admission `floor` and `margin` are fixed in `src/enrichment/semantic/model-profiles.ts`, measured on real model output so a tier works as soon as its bundle is installed. A tier outside the table fails the read with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` — never a BM25 fallback. The absolute floor sits above the strongest unrelated-corpus cosine, so a corpus with nothing relevant yields no semantic passage; a purely relative gate over the current corpus is not used.
- **Write seam**: every write targets the personal library (`zotero://user/0/`) and passes through `ctx.zotero`: capability gate → `ctx.approval.request` → plan-review card. No bypass; a stale `writeConfirm: false` cannot opt out. Writes never retry: `committed-unverified` is reconciled, not retried. Shell commands that write to the Local API are intercepted by `src/shell-write-detector.ts`.
- **Client graph**: browser code may value-import only `src/client/**`, `src/sources/**`, and the pure modules allowlisted in `scripts/client-graph-authority.mjs`; never `@deepseek-ai/schemastery`, `src/config.ts`, `src/status-codec.ts`, or `src/typert.ts`. Keep `zod` external — the build refuses an inlined copy. `src/client/index.ts` must `await ctx.remote.$mount` before injecting on `remote.zotero`.
- **Zotero wire**: `src/search-text.ts` must keep mirroring Zotero's `normalizeForSearch`. A bare `/items/{key}/children` never returns annotations; request `?itemType=annotation`. Server-paged listings require a valid `Total-Results` header, and collection and saved-search pages additionally require a valid `Last-Modified-Version`.
- **Surfaces**: 文献轨迹 is a read-only ledger projected from `ChatSnapshot`; it records read calls and exports, never writes or external results. 文献面板 reaches the library only through `ctx.zoteroLibrary` / `ctx.remote.zotero` (`browse`, `collectionPath`, `search`, `item`, `childPage`, `export`, `write`, `readUrlPdf`, `releaseUrlPdf`); the web UI never dispatches model tools, and `export` is read-only.
- **Client styling**: feature CSS consumes the host design system and defines none of it — every `var(--dsw-*/--dsh-*/--ds-*)` must exist in the host token snapshot, no literal colour outside a `mask-image`, no literal font size outside the 16px `@media (pointer: coarse)` focus-zoom guard, 1px state borders, `corner-shape: round` paired with every full-round radius, every `:hover` selector under a `hover: hover` at-rule, every transition reduced under `prefers-reduced-motion: reduce`. `npm run style:check` enforces exactly that list against the token snapshot in `tests/fixtures/style-tokens.json`; `npm run tokens:write` refreshes the snapshot after a harness upgrade. Every control is a `@deepseek-ai/dsh-client-ui-primitives` `Button`; icon-only controls use the local `IconButton` adapter, which composes `Button`; a `className` carries layout only, never geometry or colour; text-link actions use the single `src/client/components/link.module.css`. The button and `className` rules are review-enforced, not lint-enforced.
- **Teardown**: no background polling daemons — the host never polls and every request is user-driven. Accepted foreground requests settle on their original provider deadlines; a foreground ranking scope is admitted before source I/O and released in `finally`, and model resources are retained until accepted scopes and actual inference drain, so a model switch or unmount must not release them early. Owned parsing and model-download work abort and finish cleanup on unmount.

## Development rules

- Tests: one behaviour per spec; never `.only`, `.skip`, or `.todo` (use `.runIf`); synchronize on owned promises (`deferred()`), never sleeps; build fixtures with `tests/helpers/server/objects.ts`. `tests/README.md` owns the full rules, the size ratchets, and the coverage floors.
- Commits: `<type>(<scope>): <emoji> <subject>`: scope optional, lowercase type, imperative subject; body after a blank line, as bullet points explaining what and why.
- Never commit `dev.cordis.yml` or `dev-lib.cordis.yml`; both carry absolute paths. Edit the `.example` templates.

## Validation

- Iterating: focused spec + `npm run typecheck`; add `npm run build:client` for `src/client/**`.
- Behaviour changes: `npm test`.
- Cross-cutting, test-infrastructure, or release-bound: `npm run release:check`.
- Docs-only: `npm run format:check` and `npm run lint:test`.
- No workflow runs the suite on pull requests: the gate fires on push to `main`, `v*` tags, and a weekly cron. Treat local validation as the gate. Report live checks you did not run.

## Safety

- **Loopback only**: `resolveConfig` rejects a non-loopback `baseUrl`, and the Local API client never follows a redirect. External hosts are governed by the scholarly allowlist (`src/scholarly/transport/hosts.ts`); the PDF exceptions are explicit user reading under `library.allowUrlPdfRead` and the open-access PDF fulltext arm (`allowPublicPdf`), which may contact any public HTTP(S) host under the two-gate public-address check — lexical gate `isPublicUrl` in `src/transport/public-url.ts`, connect-time public-DNS resolution and pinning in `src/transport/network.ts` — ports 80/443 only, every redirect hop re-validated.
- **MinerU boundary**: the fixed API host is `mineru.net`. The `Authorization` token is host-scoped to it and is never attached to the signed upload, the result CDN, or the cache HEAD — those are dynamic untrusted public addresses under the same double gate.
- **Model downloads**: `src/enrichment/model-download-client.ts` is a separate boundary — fixed seed hosts `hf-mirror.com` and `huggingface.co`, per-revision URLs, every redirect hop re-gated, content-length precheck, streaming byte cap, SHA-256 verification, stall/deadline aborts; the host path supports no proxy.
- **Credentials**: the Zotero write grant lives in the harness credentials seam (`dsh-credentials`), never in plugin config; never log, commit, or expose it. Scholarly API keys and the MinerU token are credential references resolved per call through `ctx.credentials`; a reference that does not resolve fails the call — MinerU fails closed with `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED` — rather than degrading to anonymous access.
- **Generated output**: `lib/` is produced by `tsc` and `esbuild`; rebuild instead of editing. `coverage/` and `assets/semantic/models/` are generated too.
