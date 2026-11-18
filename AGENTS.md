# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin: agents search, read, cite, and, when enabled and approved, write a local Zotero library through the loopback Local API (`127.0.0.1:23119/api`). It ships four Cordis components: core, `dsh-zotero/library` (on), `dsh-zotero/scholarly` (off), and `dsh-zotero/enrichment` (off). Consult `docs/product-model.md` before naming a component, surface, or scope.

## Sources of truth

- Product model, vocabulary, and component boundaries: `docs/product-model.md`.
- Architecture, data flow, and service layers: `docs/architecture.md` — read before changing services, jobs, the provider, or client surfaces.
- Tool contracts, schemas, and errors: `docs/tools.md` — read before changing a tool or adding a documented example.
- Configuration schemas and defaults: `docs/configuration.md`.
- Build, launch, debug, release, and WP0–WP13 status: `docs/development.md`.
- Regression-sensitive constraints, upstream workarounds, and upgrade migrations: `docs/development-notes.md` — read before changing a covered behavior, workaround, or harness pin.
- Test lanes, fixtures, verification levels, and guards: [tests/README.md](tests/README.md) — read before adding, moving, or refactoring tests or helpers.
- Documentation ownership, writing rules, and gates: `docs/AGENTS.md` — read before adding, moving, or rewriting a document.
- Upstream harness contracts: this repo is usually developed beside `../deepseek-harness`; upstream docs and types win.

Keep `docs/x.md` and `docs/x.en.md` in lockstep. `tests/host/doc-coverage.spec.ts` checks the pairs and their stated counts; `tests/host/doc-examples.spec.ts` validates documented calls against tool schemas.

When a change creates a non-obvious constraint that future developers must preserve, add it to the matching `docs/development-notes.md` section — upstream or external contract, internal constraint or gate, or test or release gate — and update the English half in the same change. A migrated or fixed entry keeps its number as a tombstone.

## Commands and validation

```sh
npm install                  # also builds lib/ through prepare
npx vitest run <spec>        # focused iteration
npm run typecheck            # harness pin/lock plus node, test, client, and script tsc
npm run build:client         # required after src/client changes
npm test                     # test-lint guards plus full vitest suite
npm run test:integration     # opt-in live reads against Zotero
npm run format               # prettier --write; verify with format:check
npm run harness:check        # pin, lockfile, and upstream artifact freshness
npm run style:check          # client CSS guards; refresh with tokens:write after harness upgrades
npm run deps:check           # direct dependencies behind the registry; harness-owned ones excluded
npm run assets:semantic      # download/verify pinned models into ~/.dsh/models
npm run release:check        # full gate: format, strict harness, lint, typecheck, coverage, build, pack
```

- Iterating: focused spec + `npm run typecheck`; add `npm run build:client` for client changes.
- Behavior changes: `npm test`. Cross-cutting, test-infrastructure, or release-bound changes: `npm run release:check`.
- Docs-only changes: `npm run format:check` and `npm run lint:test`.
- Interactive launches and the live write probe are in `docs/development.md` and [tests/README.md](tests/README.md).
- Pull requests run only the security scanner; the quality gate runs on `main` pushes, `v*` tags, and the weekly workflow. Local validation is the merge gate. Report live checks you did not run.

## Architecture and invariants

- **Harness pin**: `@deepseek-ai/dsh-*` versions in `dependencies`, `devDependencies`, and `overrides` are exact; `peerDependencies` use `>=<pin>` and `engines.dsh` uses `>=<pin> <next minor>`. Run `npm run harness:pin -- <ver>` and refresh both lockfiles using the pin upgrade checklist in `docs/development.md`; never hand-edit the pin. Vendored `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` floors and lock resolutions follow the pinned upstream tag, not an ahead working tree. Client runtime dependencies mirror the upstream pinned `packages/client/*`; `npm run deps:check` excludes them.
- **Component authorization**: mounting scholarly authorizes external retrieval and its 7 tools; mounting enrichment accepts MinerU document egress and enables parsing, artifact reuse, and model management. The client must disclose a newly served component until acknowledged, re-disclose after the client observes the component off, and carry acceptance/revocation in session state if storage fails. A parse still needs a user-submitted, specific PDF attachment or public URL plus remote-action and session checks. Ordinary reads, PDF opening, settings saves, and startup must never submit, resume, or upload a MinerU task. Semantic ranking needs no MinerU; parsing needs no semantic model. `library.allowUrlPdfRead` (default false) separately gates URL PDF reading.
- **Enrichment seam**: enrichment depends on core, never the reverse. Core's `FulltextEnhancer.lookup` may stat a local candidate or make one token-free URL HEAD; `lookupArtifact` resolves an opaque artifact id. Neither downloads a document, uploads anything, or contacts MinerU. `zotero_retrieve` reads full documents through these arms with bounded windows, continuation tokens, or a one-shot bounded read; a missing or stale artifact is a normal miss, while permission, I/O, and protocol failures stay explicit. Parsing stays private to enrichment. The panel-parse `ctx.jobs.wait` workaround and its exit condition are in `docs/development-notes.md`.
- **Semantic ranking fails closed**: tier `floor` and `margin` values are fixed in `src/enrichment/semantic/model-profiles.ts`; an unknown tier fails with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` rather than falling back. Repository tests do not load models or use the network. `onnxruntime-web` is vendored into generated `assets/onnxruntime/`, never a runtime dependency, so the install closure carries no install script. Rebuild with `npm run build` or `npm run assets:runtime`; `npm run verify:pack` checks assets and hashes.
- **Write seam**: writes target the personal library (`zotero://user/0/`) and pass through `ctx.zotero`: capability gate → `ctx.approval.request` → plan-review card. Never bypass; a stale `writeConfirm: false` does not opt out. Never retry a write: reconcile `committed-unverified` by key/ref. `src/shell-write-detector.ts` turns recognized Local API shell writes into one pre-run approval; it is best-effort, not a boundary.
- **Client graph**: browser code may value-import `src/client/**`, `src/sources/**`, and modules allowlisted by `scripts/client-graph-authority.mjs`. Keep `zod` external; host config, status-codec, Typert, and schemastery authority stay out. `src/client/index.ts` must `await ctx.remote.$mount` before injecting on `remote.zotero`.
- **Zotero wire**: `src/search-text.ts` must keep mirroring Zotero's `normalizeForSearch`. Annotations require `?itemType=annotation`. Server-paged lists require `Total-Results`; collection and saved-search pages also require `Last-Modified-Version`.
- **Surfaces**: 文献轨迹 is a read-only ledger projected from `ChatSnapshot`. 文献面板 reaches the library only through `ctx.zoteroLibrary` / `ctx.remote.zotero`; it never dispatches model tools, and `export` is read-only.
- **Client styling**: feature CSS consumes the host design system. `npm run style:check` enforces the token, typography, palette, radius, border, hover, and reduced-motion rules against `tests/fixtures/style-tokens.json`. Controls use the host `Button` primitive; icon-only controls use the local `IconButton` adapter; `className` carries layout only; text links use `src/client/components/link.module.css`. The `Button`/`className` rules are review-enforced.
- **Teardown**: no background polling daemons. Admit a foreground ranking scope before source I/O and release it in `finally`; recycle the resident model after `semanticIdleTimeoutMs`. Owned parsing, model-download, and URL PDF work abort and clean up on unmount.

## Development rules

- Follow [tests/README.md](tests/README.md): one behavior per spec, no `.only`/`.skip`/`.todo`, synchronize on owned promises, and use the shared fixtures.
- Commits: `<type>(<scope>): <emoji> <subject>`; lowercase type, imperative subject, blank line, then bullets explaining what and why.
- Never commit `dev.cordis.yml` or `dev-lib.cordis.yml`; edit the `.example` templates.

## Safety

- **Local API**: `resolveConfig` rejects non-loopback bases and the Local API client never follows redirects. Keep scholarly external traffic behind its HTTPS allowlist. User-initiated URL PDF reading, open-access PDFs, MinerU, and model downloads each use their own public-address checks; every redirect hop is re-validated. The `198.18.0.0/15` fake-IP exception applies only to reviewed allowlist hosts, HTTPS public PDFs, and HTTPS MinerU; plain HTTP and model downloads keep the strict gate. Deterministic address/policy refusals are final; transient resolution failures may be retried.
- **MinerU boundary**: the API host is fixed to `mineru.net`. Attach the `Authorization` token only there; never attach it to signed uploads, result CDNs, or cache HEADs.
- **Model downloads**: `src/enrichment/model-download-client.ts` permits only the fixed seed hosts, per-revision URLs, re-gated redirects, a byte cap, and SHA-256 verification; the host path has no proxy.
- **Credentials**: the Zotero write grant lives in `dsh-credentials`, never plugin config. Scholarly keys and the MinerU token are references resolved per call through `ctx.credentials`; unresolved references fail closed, especially MinerU's `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`.
- **Generated output**: `lib/`, `coverage/`, `assets/onnxruntime/`, and the ignored model files under `assets/semantic/models/` are generated; rebuild instead of editing.
