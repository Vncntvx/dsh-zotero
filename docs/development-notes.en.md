<p align="right"><a href="development-notes.md"><b>中文</b></a></p>

# Development notes

<!-- harness-reviewed: 0.2.2-rc.3 -->

Current host contract review: 2026-11-17, pin `0.2.2-rc.3`. DN-1 waiter settlement, DN-2 read and Worker lifecycle, DN-3 publication/deletion exclusion, and DN-4 inventory write generations were checked against current implementations and their tests. Earlier status dates and pins record introduction. On upgrades, review active entries and their evidence before updating this record; the pin writer never replaces that review automatically.

## Position and scope

This page records critical development constraints, including upstream-contract workarounds, upgrade-triggered migrations, and behavior boundaries that are easy to miss in the code and tests. Each entry explains why the constraint exists, when to review it, how to verify it, and how to converge the implementation when the condition changes. Keep the Chinese and English pages synchronized whenever an entry changes.

## Entry requirements

- **Type**: upstream contract / lifecycle / security boundary / compatibility / other development constraint.
- **Status**: active / pending review / retired.
- **Location**: source, test, or configuration path and symbol.
- **Key point**: the behavior, assumption, or boundary future changes must preserve.
- **Trigger**: when to review the point, and the command or evidence to use.
- **Verification**: how the current implementation proves the point.
- **Follow-up**: how to migrate, remove, or update the implementation and tests when the condition changes.

An upstream-contract workaround must also state the current symptom, current workaround, why it is a compromise, and the specific upstream ask. An entry without verification or follow-up is incomplete. Run the Upgrade review procedure on every harness pin bump.

## DN-1: Panel parse completion notices

- **Type**: upstream contract.
- **Status**: active (2026-11-13, pin `0.2.2-rc.2`).
- **Location**: `holdNotice`, `PARSE_NOTICE_WAIT_MS`, and `PARSE_NOTICE_REARM_MS` in `src/enrichment/parse-jobs.ts`.
- **Symptom**: after the library panel parses a PDF, the harness posts a background-job notice to the owning session, and an idle session is woken into a new turn. The notice only asks the model to read the job output; a parse job's output is a receipt (artifactId, character count, bounded preview) with no body or readable path. The model then searches the host filesystem and produces an unsolicited parse report.
- **Current workaround**: the parse job is registered with an `owner` and no `toolCall`. Right after `registry.start` returns, the host holds a `ctx.jobs.wait` and arms a successor every half waiter lifetime; at any settlement at least one waiter is live, the registry marks the settlement `awaited`, and tool-jobs skips the completion notice. The waiters never consume output, cancel the job, or remove the settled record.
- **Why it is a compromise**: it expresses **intent** through an **observation**. `awaited` means "some caller already received the terminal projection", not "the model does not need to know about this job"; the workaround only holds because tool-jobs currently treats `awaited` as already delivered. Any future consumer that reads `awaited` as "the model consumed this" receives a false signal. The remaining assumption is Node's due-timer ordering plus microtask draining between callbacks: a successor always expires before its predecessor, so even when both are overdue the successor registers first; an event loop stalled longer than a wait window has already broken the rest of the process's lifecycle too. The steady state is two waiters and one interval, all cleared at settlement.
- **Upstream ask**: either option retires this workaround.
  1. **Declared intent**: add `notify?: false` (or an equivalent `modelFacing?: false`) to `JobSpec`, carry it to `JobSettledData`, and have tool-jobs honor it before building a notice. This serves any host-initiated job.
  2. **Infer from provenance**: expose `toolCall` on `JobView` (the durable registration already stores it; only the projection is missing) and have tool-jobs announce only jobs created by a tool call. Host-initiated jobs become silent automatically, but host jobs that do want a notice lose it.
- **Review trigger**: after every `npm run harness:pin -- <ver>`, and whenever `npm run harness:check` reports changed upstream artifacts, run the fixed checks: search `node_modules/@deepseek-ai/dsh-jobs/src/types.ts` for `notify`, `silent`, and `modelFacing`; search `node_modules/@deepseek-ai/dsh-jobs/src/view.ts` for `toolCall`; read the `dsh-tool-jobs` delivery conditions to confirm `awaited` is still the only runtime state it skips. When either mechanism appears, move this entry to pending review and migrate in the same pin change.
- **Migration**: delete `holdNotice` and both re-arm constants; switch the parse job to the new declaration (or rely on provenance gating); replace the `awaited` assertions in `tests/host/enrichment-parse-jobs-notice.spec.ts` with the new contract (a panel parse produces no notice, while a `run_in_background` job still does); update `docs/architecture.md`, `docs/architecture.en.md`, and `AGENTS.md`; move this entry to the retired list.
- **Acceptance**: at the current pin, the completed, failed, killed, and cross-window cases all report `awaited === true`, and deleting `holdNotice` makes them fail; after migration, deleting the workaround still keeps a panel parse from waking the model while a model-started background job still receives its completion notice.

## DN-2: Complete document read snapshots and Worker

- **Type**: Lifecycle / security boundary.
- **Status**: Active (2026-11-14, pin `0.2.2-rc.2`).
- **Location**: `artifact-reads.ts`, `parsed-documents.ts`, `archive-worker.ts`.
- **Behavior**: Each read lease belongs to a real peer, session, original Agent and the store fixed at open. Source generations and output-directory changes leave the old snapshot intact. Browser connections can share browserPeer, so explicit release, one-shot deadlines and resource budgets jointly cover closed pages; peer.signal alone is insufficient. Authorization is checked before and after each read; abandoned leases expire. Candidate and displayed versions own separate Blob URLs, and replacement requires complete preparation. Release immediately removes the active lease and its deadline timer; draining transfers retain their own concurrency slots. Pre-admission cancellations use a separate bounded, expiring registry and consume no preparation slots. Release also revokes same-id requests already awaiting ownership checks.
- **Worker**: ZIP extraction, reference analysis and content-list semantic validation run in the Worker. The parent validates the closed message and persistence accepts normalized payloads. Cancellation awaits Worker exit before releasing admission. Published execution uses `lib/enrichment/zip-worker.js`, emitted by the normal build/prepare path. The archive admission's concurrency and queue ceiling come from the configured `artifactReader`; `ParseFlight` must receive that live limits policy, because building it with the defaults silently voids both settings.
- **Review trigger**: Harness resource, peer or invocation upgrades; snapshot policy or artifact format changes; Worker build-path changes.
- **Verification**: `enrichment-read-snapshots`, `enrichment-read-lifetime`, `enrichment-archive-worker`, `enrichment-archive-admission`, and `parsed-document-*` tests, plus the real JS Worker smoke in `verify:pack`.
- **Follow-up**: When upstream supplies connection-level lifetime or resource refresh, verify its semantics before replacing local management; retain source-binding, complete-publication and cleanup regressions.

## DN-3: Two non-atomic commits for a parsed artifact

- **Type**: security boundary / lifecycle.
- **Status**: active (2026-11-14, pin `0.2.2-rc.2`).
- **Location**: `putNormalized` in `src/enrichment/parse-once.ts`, `putSources` in `src/enrichment/parse-document.ts`, `src/enrichment/artifact-management.ts`, `src/enrichment/artifact-target.ts`.
- **Behavior**: the artifact directory (with `meta.json` as its commit marker) and `sources/index.json` are two independent writes. A crash between them leaves an orphan directory with no index record or a dangling index key pointing at a removed directory; one URL parse also publishes up to three alias keys. The inventory must union both views by cacheKey and deduplicate them. A discard must clear every alias key, the task file, the parse receipts for that generation and the in-memory job state, after invalidating read leases bound to the artifact. Deletion first reserves that generation, aborts and drains all related parsing, then removes storage. In-flight admissions retain revocation markers, so a stale receipt read cannot replay successfully after deletion finishes. A first orphan with no `sources/` directory must still be removable by safely creating the index lock directory. `documentArtifact`'s `inspect` accepts only concrete targets, requires a live session and may send a HEAD for URLs, so it cannot enumerate; enumeration goes through `probe` — one batched freshness probe per page (bounded concurrency, one index snapshot per batch) whose per-ref semantics match a single-target `inspect`, still never contacting MinerU. `meta.json`'s `sourceUrl` keeps the complete canonical URL (matching the index's `stamp.url`) to recover an orphan target, but it never enters `identity`, receipts, wire results or display fields; list rows carry only `origin/…`. Revisit all three whenever `artifactMetaSchema`, the `parse-once` commit order, or the artifact/index publication order changes.
- **Review trigger**: artifact schema, parse commit flow, source-index structure, list/discard endpoint changes, or harness storage/file-lock upgrades.
- **Verification**: `tests/host/enrichment-artifact-management.spec.ts` (three-state union, alias dedup, complete cleanup), `tests/host/enrichment-artifact-target.spec.ts` (attachment/URL/orphan target recovery), `tests/unit/enrichment-parsed-manager-wire.spec.ts` (no complete URL on the wire), `tests/host/enrichment-parse-document.spec.ts` (identity redaction), `tests/host/enrichment-artifact-metadata.spec.ts` (lease-free meta/probe and batched freshness).
- **Follow-up**: if an atomic transaction for the artifact directory and index becomes available, the directory enumeration and `orphan`/`broken` states can be dropped and the discard reduced to one transaction; keep the regressions that complete URLs never enter the wire and that a discard refreshes open parsed tabs.

## DN-4: Write-generation invalidation for the artifact inventory

- **Type**: lifecycle / performance boundary.
- **Status**: active (2026-11-14, pin `0.2.2-rc.2`).
- **Location**: `touch`, `inventory`, `groupByArtifact` in `src/enrichment/artifact-store.ts`; `storeFor` in `src/enrichment/service.ts`.
- **Behavior**: store instances are memoized per resolved root (one instance per root), and the inventory (directory enumeration plus one `metaFor` per cacheKey) is cached per write generation; every attempted write — including a failing one — opens with `touch()`, which bumps the generation and invalidates the caches. Any new store write path must open with `touch()` too, or the inventory and grouping views read stale data. The source index itself is read per call and never cached: index I/O failures must surface, never hide behind a cache.
- **Review trigger**: adding or changing any `ParsedArtifactStore` write path, or changing what the inventory and grouping derive from.
- **Verification**: the "serves the inventory from cache until the store is written again" and grouping cases in `tests/host/enrichment-artifact-management.spec.ts`; the index-read contract in `tests/host/enrichment-artifact-store.spec.ts`.
- **Follow-up**: when upstream offers change notifications or invalidation hooks for the artifact store, replace the write generation with authoritative invalidation; keep the "write invalidates" and "index failures are never cached" regressions.

## DN-5: The pack smoke must escape the parent's npm dry-run mode

- **Type**: other development constraint (npm CLI behaviour).
- **Status**: active (2026-11-15, npm 12).
- **Location**: `smokeArchiveWorker` in `scripts/smoke-archive-worker.mjs`.
- **Behavior**: `npm publish --dry-run` runs `prepublishOnly` with `npm_config_dry_run=true`. The smoke's nested `npm pack` inherits that environment and produces zero tarballs, so `verify:pack` fails with "npm pack did not produce exactly one tarball". The smoke removes that variable from the child environment so the nested pack produces a real tarball; every other npm setting is inherited unchanged.
- **Review trigger**: run `npm publish --dry-run` again when the release gate's script chain changes, the npm major moves, or this smoke gains another child process.
- **Verification**: `npm publish --dry-run` completes, and its log carries both `archive-worker pack smoke ok` and `verify-pack ok`; a standalone `npm run release:check` still passes.
- **Follow-up**: if npm stops passing dry-run to lifecycle children, or offers an explicit opt-out, delete the environment cleanup and keep the assertion that the smoke produces one real tarball.

## DN-7: The semantic-ranking runtime ships inside the package

- **Type**: Compatibility / install policy.
- **Status**: Active (2026-11-15, pnpm 11 `strictDepBuilds`).
- **Location**: `scripts/vendor-onnxruntime.mjs`; `src/enrichment/semantic/runtime.ts`; `files`, `build`, and `devDependencies` in `package.json`; `scripts/build-prepare.mjs`; `scripts/verify-pack.mjs`; `scripts/shared/build-approvals.mjs`; `tests/unit/tooling/vendor-onnxruntime.spec.ts`.
- **Symptom**: the WASM runtime behind semantic search, `onnxruntime-web`, depends transitively on `protobufjs`, which ships a no-op `postinstall`. pnpm 11 enables `strictDepBuilds` by default, so an undecided dependency build script makes the whole install exit non-zero (`ERR_PNPM_IGNORED_BUILDS`) and the desktop plugin install rolls back. 1.1.0 was the first release to carry it as a runtime dependency, so every install of 1.1.0 failed on pnpm 11.
- **Current approach**: the runtime is **not a dependency** but a build asset inside the package. `scripts/vendor-onnxruntime.mjs` copies the Node entry, the wasm glue, and the wasm binary (about 3.8 MB gzipped) from the pinned `onnxruntime-web@1.31.1` dev dependency into `assets/onnxruntime/1.31.1/`, writes `provenance.json` (source, bytes, SHA-256), and drops any other version directory; `assets/onnxruntime/LICENSE` always carries the MIT text. `semantic/runtime.ts` loads that entry by absolute `file://` URL and points `env.wasm.wasmPaths` at the same directory (it must end with a separator; the runtime concatenates the file name). The assets are generated like `lib/` (gitignored): `npm run build`, `scripts/build-prepare.mjs`, and `npm run assets:runtime` all regenerate them, and `verify:pack` checks the hashes, the license, and that the three files really reach the tarball. `onnxruntime-common` is the only ordinary dependency (no install script, no dependencies of its own).
- **Review trigger**: revisit when `onnxruntime-web` is upgraded (the exact `devDependencies` pin and `SEMANTIC_RUNTIME_VERSION` must move together or the guard spec fails), when any runtime dependency is added, when pnpm changes major version, or when upstream changes its plugin-install or build-approval policy.
- **Verification**: `tests/unit/tooling/vendor-onnxruntime.spec.ts` (version and file-list agreement, hashes, license), `tests/unit/enrichment-semantic-runtime.spec.ts` (load path, `wasmPaths`, fail-closed on missing files), and `tests/unit/tooling/build-approvals.spec.ts` with `tests/unit/tooling/verify-pack.spec.ts` (no install script in the closure, packaged paths complete). Manual check: install the packed artifact into a clean profile with the desktop runtime's pnpm 11.28.5 — it must succeed with no approval; then import the packaged entry from the installed location and call `InferenceSession.create` on an empty file, which must answer with the wasm-side `No graph was found in the protobuf`, proving the glue and binary loaded.
- **Follow-up**: if pnpm lets a dependency declare or waive build scripts, or if `onnxruntime-web` widens `protobufjs` to 8.x (8.x dropped the `postinstall`), move the runtime back to `dependencies` and delete the vendor script, the packaged assets, and their guards; until then, regenerate with `assets:runtime` on every upgrade and re-check the package size.

### DN-8: The panel resolves its own type names and authors, and keeps paged lists

- **Type**: data contract / display semantics.
- **Status**: in effect (2026-11-15, pin `0.2.2-rc.2`).
- **Location**: `ZoteroSearchItemView` in `src/contract.ts`, `searchItemViewOf` in `src/library-views.ts`, `src/client/library-item-type-locales.ts`, `item-type-labels.ts`, `use-item-type-labels.ts`, `LibraryItemList.tsx`, and `LibraryInspector.tsx`.
- **Behavior**: a row's authors come from the structured `authors` the wire now carries, its type label resolves plugin dictionary → Zotero's `/itemTypes` `localized` → the raw `itemType`, and its venue comes from `venue`. `meta.creatorSummary` still crosses the wire but only backs up a missing author list: it is a string Zotero builds in its own language (a Chinese Zotero joins two authors with a conjunction and no surrounding spaces), so the display layer cannot correct it without risking the names themselves, and no longer consumes it. The panel reads the item-type vocabulary once above the three panes (`useItemTypeVocabulary`) and shares it with the filter menu, the list rows, and the inspector eyebrow; the filter rail no longer walks it, so a scope change repeats nothing. The item list keeps previous/next paging: the official client uses show-more everywhere, but this plugin targets libraries with tens of thousands of items, where jumping between ranges matters and an accumulating window would grow the DOM without bound. That divergence from the official paradigm is deliberate (`docs/features.md`: "item lists use standard pagination"), not a pending task.
- **Review trigger**: revisit when the harness is upgraded (wire codecs / `Remote` contract), when Zotero renames or drops `/itemTypes` `localized`, when a new custom item type appears, or when the product decides to make the item list accumulate pages.
- **Verification**: `tests/unit/library-views.spec.ts` asserts `authors`/`venue` cross the wire and an empty author list leaves no key; `tests/client/library/remote-contract-library.spec.ts` asserts the strict codec accepts both optional fields; `tests/client/library/use-item-type-labels.spec.tsx` asserts the paged walk, retry after failure, a non-advancing cursor, the unmount drop, and the three-step resolution order; `tests/client/library/library-panel.interaction.spec.tsx` asserts the current row's `aria-current`, its friendly type label, venue, and structured authors; `tests/client/library/library-tree.spec.tsx` asserts the collection item-count badge and that an unreported count renders nothing; `tests/client/library/library-inspector-layout.spec.tsx` asserts the abstract window appears only when the prose overflows.
- **Follow-up**: if upstream starts carrying a localized type name or structured authors (for example a wire `localizedItemType`), delete the client dictionary and the `/itemTypes` walk and consume the wire instead; if paging ever becomes accumulating, migrate to `LibraryLaneControls.tsx`'s show-more plus loaded-count pattern and update the window state in `library-storage.ts` together with `docs/features`.

### DN-9: Upstream's "no session surface" refusal is prose, so the client matches a substring

- **Type**: upstream workaround (missing error code).
- **Status**: in effect (2026-11-15, pin `0.2.2-rc.3`).
- **Location**: `NO_SESSION_SURFACE_REFUSAL` and `openFile` in `src/client/components/library/ZoteroLibraryPanel.tsx`; `tests/client/library/library-panel.reader.spec.tsx`.
- **Behavior**: opening a local PDF goes through the host right sidebar's `openResource`. When the current conversation has no session surface mounted, `@deepseek-ai/dsh-client-ui-sidebar-right` (`src/client/service.ts`) throws `new Error('sidebarRight: no session surface is mounted')` — no error code and no distinguishable error type. To show the branch as its own hint (`libraryNoSessionForOpen`), the plugin can only match that message text.
- **Current approach**: the substring lives in the `NO_SESSION_SURFACE_REFUSAL` constant with its upstream provenance in the comment; the spec throws the same constant rather than keeping a second copy of the prose. Other `openResource` failures keep their own message (there is a separate case). The match uses `includes` because upstream prefixes the sentence with `sidebarRight: `.
- **Review trigger**: after every `npm run harness:pin`, re-check the string in the sibling source: `rg "no session surface is mounted" ../deepseek-harness/packages/client/ui-sidebar-right/src`.
- **Verification**: `tests/client/library/library-panel.reader.spec.tsx` (the refusal becomes the panel hint; a foreign refusal keeps its own message).
- **Follow-up**: if upstream gives that branch an error code or error type, switch to matching the code and delete the constant and this entry.

### DN-10: The client loader API and the `resultText` mirror stay at pin semantics

- **Type**: version-drift preparation.
- **Status**: in effect (2026-11-15, pin `0.2.2-rc.3`; upstream HEAD has moved, rc.3 has not).
- **Location**: `CLIENT_LOADER_API`/`assertLoaderApi` and the `data-plugin-css` injection in `scripts/build-client.mjs`; `resultTextOf` in `src/sources/presenters.ts`.
- **Behavior**: both mirrors are written against rc.3 while the sibling HEAD already changed.
  - Module loader: this plugin injects its stylesheet as `<style data-plugin-css="dsh-zotero">` and hands off with `load({ id, factory })`; upstream HEAD moved to `load({ id, factory, meta: () => ({ stylesheets }) })` and removed the `data-plugin-css` handling. That change is not in the rc.3 tag.
  - `resultText`: `resultTextOf` matches rc.3 (every part joined with `\n`). HEAD joins with `reduce` (no extra newline when a part already ends with one) and grew an optional `formatImage` argument.
- **Current approach**: `CLIENT_LOADER_API` is this repository's single statement of which handoff the loader accepts, because the browser loader is a shell global, not an installable package — no local type can answer it. `assertLoaderApi` checks the produced bundle at build time against that constant: the constant naming `meta-stylesheets` while the bundle still injects the legacy tag, and the bundle dropping the tag while the constant still names the legacy form, both fail the build instead of silently losing styles or the handoff at runtime. The `resultTextOf` JSDoc now names the two differences from HEAD instead of claiming the semantics are copied exactly.
- **Review trigger**: after every `npm run harness:pin`, re-check both upstream implementations (`packages/client/tsdown.client.ts`'s module registration and `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`'s `resultText`). When upstream ships `meta.stylesheets`, flip the constant, migrate the style injection, and raise the `engines.dsh` floor to a release that includes it, all in one change.
- **Verification**: `tests/unit/tooling/build-client-bundle.spec.ts` covers three directions (legacy accepted, each drift refused); `tests/client/presenters.spec.ts` pins the current `resultText` behavior; `npm run build:client` and `npm run harness:check`.
- **Follow-up**: when the migration lands, delete the `data-plugin-css` branch, `CLIENT_LOADER_API` and `assertLoaderApi`; if upstream ever exports `resultText` from `./client`, import it and delete the mirror.

### DN-11: An artifactId read validates the artifact, never probes its source

- **Type**: security/performance boundary.
- **Status**: in effect (2026-11-15).
- **Location**: `lookupArtifact`/`lookupArtifactFrom` in `src/enrichment/service.ts`; `resolveArtifactTarget` in `src/enrichment/artifact-target.ts`.
- **Behavior**: `lookupArtifact` is the only entry for an opaque artifactId. It hits a read-through cache keyed by `(artifactId, contentFingerprint, parseGeneration, store.writes)`; on a miss it reads the source index and one `meta.json` to recover the concrete source. An artifactId addresses the local artifact, so a parsed URL document remains readable offline after its parse-time source check, and deleting the local attachment does not invalidate it. Reading by item ref (`lookup`) still performs one stat/HEAD because that path reads Zotero's index text.
- **Review trigger**: when the artifact lifecycle changes (for example artifacts are reclaimed with their source), or when upstream asks an id-addressed read to verify source freshness too.
- **Verification**: `tests/host/enrichment-service.spec.ts` asserts an artifactId hit issues no HEAD, an unknown id is a fault, and the answer carries the real source facts.
- **Follow-up**: if the product decides a vanished source invalidates the artifact, add one budgeted probe in `resolveArtifactTarget` and turn this entry into a probe policy.

### DN-12: Ranking-scope admission and model recycling

- **Type**: resource lifecycle.
- **Status**: in effect (2026-11-15).
- **Location**: `src/enrichment/semantic/loader.ts`; `armSemanticIdleRecycle` in `src/enrichment/service.ts`.
- **Behavior**: `retrieve` calls `ranker.admit()` before any source I/O, and the scope records the target and generation admitted. The load starts on that scope immediately rather than at the first `embed()`. A model switch after admission therefore cannot move that read onto another model, and an unmount cannot cut an accepted scope short: `dispose()` only closes new admission, and an admitted instance is released after `release()`. A resident model is released after `semanticIdleTimeoutMs` (default ten minutes) without requests and re-opened from disk by the next ranking; teardown clears the timer.
- **Review trigger**: when the ranking interface's admission semantics, the model load transaction, or the idle-recycle configuration change.
- **Verification**: `tests/unit/semantic-loader-lifecycle.spec.ts` (A→B transaction, failed B leaving A managed, an admitted scope surviving teardown, retire/reopen, idempotent dispose), `tests/host/enrichment-semantic-lifecycle.spec.ts`, `tests/unit/enrichment-config.spec.ts` (the idle field).
- **Follow-up**: if upstream offers a primitive that binds a model generation per call, delete the local scope layer.

### DN-13: Proxy routing and address pinning are mutually exclusive, and one undici copy serves everything

- **Type**: security + dependency consistency.
- **Status**: in effect (2026-11-15, `dsh-http-proxy` published).
- **Location**: `egressRouteFor`/`publicFetch`/`createPinnedDispatcher` in `src/transport/connections.ts`, and the four external egress paths (MinerU, scholarly retrieval, URL PDF, model downloads).
- **Behavior**: `proxyRouteFor(url)` decides one request's route: proxied uses the process-wide dispatcher the proxy package installs — **the proxy performs DNS, so no address pinning applies and the dispatcher is never closed (process-wide)**, while the lexical public-address gate still runs; only direct resolves addresses, pins the closed set and closes per attempt. The two cannot be combined: pinning binds the addresses this process resolved, and a proxy resolves again, so using both abandons check-then-connect. `pinned.dispatcher` is accepted only by the `fetch` from the undici copy in `connections.ts`; the runtime global `fetch` rejects it at the handler interface with `UND_ERR_INVALID_ARG`. `dsh-http-proxy` pins the same undici version as the root dependency, otherwise one dispatcher would cross two copies; the lockfile keeps them identical.
- **Review trigger**: when the harness (proxy package version) is upgraded, when undici changes, or when a new external egress path is added; `npm run deps:check` and `tests/unit/tooling/harness-mirrored-deps.spec.ts` warn first.
- **Verification**: `tests/host/*-proxy*`, `tests/scholarly/network.spec.ts`, `tests/scholarly/transport/fake-ip-policy.spec.ts` (the pinned dispatcher reaches the fetch init, fake-proxy and private addresses refused), and the fetch-ownership guard in `node scripts/test-lint.mjs`.
- **Follow-up**: if upstream merges proxy routing and pinning into one API, delete the local `egressRouteFor`.

### DN-14: `scrubbedParentEnv` adds the proxy variables back

- **Type**: behavior change (a side effect of reusing upstream).
- **Status**: in effect (2026-11-15).
- **Location**: `scrubbedEnvironment` in `src/environment.ts`; the launcher child process in `src/local/terminal.ts`.
- **Behavior**: the local scrub used to only subtract (drop credential-shaped names and `DSH_*`). Switching to `@deepseek-ai/dsh-subprocess`'s `scrubbedParentEnv()` subtracts the same names and additionally layers the host's proxy variables into the child environment.
- **Current approach**: that is exactly what the launcher wants — the child must reach the network the way the host does, or a terminal in a proxied environment loses its network. An explicitly supplied environment (a test's synthetic map) still goes through the same rule without that layering, because that map is the environment the caller chose.
- **Review trigger**: when the harness is upgraded (`SENSITIVE_ENV_PATTERN` / `scrubbedParentEnv` semantics change) or when the launcher needs to diverge from the host's network policy.
- **Verification**: `tests/unit/environment.spec.ts` (WSL detection, process environment through upstream, an explicit environment without the proxy layering), `tests/host/terminal*.spec.ts`.
- **Follow-up**: if upstream splits the proxy layering into an explicit switch, choose it per launcher need.

## Upgrade review

Every harness pin change walks this page from the top: check whether upstream now provides the requested contract; if it does, migrate and retire the entry in the same change, because a capability that exists while the workaround remains is not an acceptable state. If it does not, update only the pin version and the review date, leaving the workaround untouched.

## DN-15: Build digests and release artifact identity

- **Type**: security boundary / release constraint.
- **Status**: active (2026-11-16, pin `0.2.2-rc.3`).
- **Location**: `scripts/build-state.mjs`, `release-artifact.mjs`, `release-tar.mjs`, `publish-release-branch.mjs`, and `release-branch.yml`.
- **Behavior**: a successful complete build/prepare records digests for the sources, scripts, configuration, lockfile, toolchain and every emitted file. The quality gate creates one artifact with scripts, dev dependencies and development-only overrides removed. Retaining those overrides after removing dev dependencies conflicts with peer ranges and can make `npm pack` fail with `EOVERRIDE`. Fresh Linux, macOS and Windows profiles install the same tarball with the published, exactly pinned CLI and pnpm 11, then import all four host entries from the installed package through the host's public profile resolver. Peer dependencies come from the host installation, so bare Node imports do not represent the runtime. Linux also runs browser Web smoke. Publication consumes the existing artifact. Verification binds the source SHA, closed file set, individual digests, tarball digest and packed contents. The publish job checks out without credentials, and the write token reaches only the final push step. Publication targets the project's origin release branch and uses the observed old ref as a CAS lease; source rollbacks and byte changes are rejected.
- **Review trigger**: build inputs, artifact layout, publication entry, Actions, Node or compiler changes.
- **Verification**: `build-state.spec.ts`, `release-artifact.spec.ts`, `release-branch.spec.ts`, `release:check`, and smoke against the actual tarball.
- **Follow-up**: add new build inputs to the digest and new release files to the verified set. Preserve tamper, missing-file, source rollback and credential-isolation checks after tool upgrades.

## DN-16: Actual ZIP expansion budgets and integrity proof

- **Type**: security boundary / lifecycle.
- **Status**: active (2026-11-16, pin `0.2.2-rc.3`).
- **Location**: `src/enrichment/zip-reader.ts`, `zip.ts`, and `archive-worker.ts`.
- **Behavior**: verify agreement among the directory, local headers, data descriptors and entry ranges before inflating selected text and referenced figures. Native deflate `maxOutputLength` caps actual output; output length, consumed compressed length and CRC must all match. The declared originalSize is metadata, while the actual output limit controls memory use. The Worker has heap/stack limits and a 30-second deadline; cancellation waits for exit before releasing admission.
- **Review trigger**: Node/zlib upgrades, ZIP format support, archive budgets or Worker admission changes.
- **Verification**: `enrichment-zip-integrity`, `enrichment-zip-safety`, `enrichment-archive-worker`, and the packed JS Worker smoke.
- **Follow-up**: additional compression formats require the same hard output limit and integrity proof. Keep forged-size, CRC, directory mismatch and cancellation/exit regressions.

## DN-17: Pinned authority for style tokens

- **Type**: upstream contract / build constraint.
- **Status**: active (2026-11-16, pin `0.2.2-rc.3`).
- **Location**: `installedThemeSheets`, `RUNTIME_SEAMS`, and `verifyRuntimeSeams` in `scripts/style-tokens.mjs`.
- **Behavior**: CI checks dsw/ds against the exact theme source installed from the lockfile; linked development reads the sibling's pin tag. Each dsh runtime seam maps to a setting, CSS definition or setProperty call in that pin, and the provenance table and snapshot agree as closed sets.
- **Review trigger**: every harness pin upgrade, token addition or upstream definition move.
- **Verification**: `tokens:check` runs in `release:check`; `style-tokens.spec.ts` refuses missing tokens, wrong versions and missing definitions.
- **Follow-up**: replace the provenance table with an upstream public token manifest when available; retain exact-pin and deletion checks.

## DN-18: Parsed pages never fetch remote images automatically

- **Type**: security boundary / performance budget.
- **Status**: active (2026-11-16).
- **Location**: `src/client/remote-image-links.ts`, `parsed-markdown.ts`, `scripts/client-graph-authority.mjs`, and `build-client.mjs`.
- **Behavior**: before display, a GFM/math syntax pass converts direct and reference HTTP(S) images to ordinary links while retaining the complete original document. Only artifact-owned local figures render through controlled Blob URLs. Code examples remain intact. The pure parser closure is explicitly allowlisted; its roughly 88 KB cost brings the measured bundle to 750 KB, under an 800 KiB limit. The current upstream renderer accepts remote images before calling pathImages, so pathImages cannot enforce refusal.
- **Review trigger**: primitives Markdown grammar or imageSource upgrades, new Markdown extensions, or image lifetime changes.
- **Verification**: `parsed-markdown.spec.ts` and `parsed-document-images.spec.tsx` prove remote, loopback and reference images create no img elements while local figures and code survive. The build checks the dependency closure and size.
- **Follow-up**: migrate when upstream publishes an image policy API covering remote targets, remove the duplicate parse and its dependency closure, then reduce the measured size budget.

## DN-19: Single-use grants, complete write cycles and receipts

- **Type**: Zotero protocol / concurrency and security constraint.
- **Status**: Active (2026-11-16).
- **Location**: `write-auth.ts`, `write-authorization-budget.ts`, `write-operation.ts`, `local/write-keyed-batch.ts`, `local/write-trash-graph.ts`, `write-plan.ts`, `local/write-content-proof.ts`.
- **Behavior**: Zotero consumes a single-use key at authentication. Authorization through completed dispatch must be exclusive. The service retains the operation gate and prompt budget across transport rebuilds. The 15-minute deadline starts after approval and includes queueing and authorization; it must preserve a dispatched write's unknown commit state. Native POST accepts existing key/version entries with PATCH merge semantics, at most 50 objects, each committed independently. Dependency layers must settle before their parents. Every receipt proves its index, identity, version and all submitted fields; missing or contradictory proof returns `committed-unverified` and never permits resending. Notes compare HTML structure, allowing only verified Zotero envelopes, control-character removal and equivalent HTML parsing. Tags and collections compare as sets; personal-library relation URIs normalize to local identity. Saved-search PATCH reads back and verifies the name, complete conditions and version. Revocation atomically removes the credentials secret. If credentials revocation fails during 401 recovery, preserve `ZOTERO_WRITE_UNAUTHORIZED` with both the original refusal and storage error as causes, and stop authorization and dispatch. Approval documents retain complete values and isolate their Markdown syntax. A custom plan-review response always declines the current write and returns its exact text as `declined.feedback` in canonical output, rendered content and presentation, even if the same answer also selects Apply. Collection creation, note updates and collection-membership updates first use read-only `preflightWrite` to reject known invalid targets. Execution rechecks after approval instead of writing from the earlier snapshot. Collection and saved-search PATCH/DELETE share `local/write-record.ts` for authorization, version preconditions, 404 refusals and uncertain-commit receipts; each domain retains its field handling and saved-state verification.
- **Review trigger**: A Zotero write, grant-consumption or rate-limit protocol change; a credentials atomic-interface change; changes to graph ordering or approval rendering.
- **Verification**: `batch-one-time-grant`, `trash`, `restore-items`, `write-operation`, `write-authorization-budget`, `write-auth`, `plan-literal-values`. Protocol evidence comes from the installed Zotero `server_localAPI.js` implementation of `writeMultipleObjects`, authentication and authorize.
- **Follow-up**: Recheck per-object transactions and grant consumption during upgrades. Retain partial-conflict, missing-receipt, queued cancellation, total-deadline and rebuild-serialization regressions.

## DN-20: Shared model verification and inference admission

- **Type**: Local-file integrity / resource ownership constraint.
- **Status**: Active (2026-11-16).
- **Location**: `enrichment/model-bundle-inspector.ts`, `regular-file.ts`, `semantic/bundle.ts`, `tokenizer.ts`, `batching.ts`, `session.ts`, `vector-cache.ts`, `evidence-query.ts`.
- **Behavior**: Installation, status and loading share exact catalog inspection. Manifest reads cap at 64 KiB before allocation; pinned paths and parent directories reject symlinks. Runtime readers hash the actual byte snapshot consumed by ONNX and JSON parsers, bounded by pinned size. The process verification cache holds at most 16 identities and is cleared on component teardown. Queries and paraphrases cap at 2,000 characters before source I/O; embedding text including its prefix caps at 131,072 characters before encode. One cache generation admits one inference batch at a time. Padded batches split at 32,768 tokens without dropping rows or repeating encoding. Cache identity includes the complete model contract, including tier and token window.
- **Review trigger**: Catalog windows or dimensions, tokenizer allocation, runtime byte-buffer ownership, inference concurrency, or file inspection changes.
- **Verification**: `semantic-bundle`, `semantic-open-ownership`, `semantic-admission-budget`, `semantic-vector-cache`, and `evidence-query-admission`. Tests use tiny real files and controlled session outputs; no repository test loads a model.
- **Follow-up**: Preserve exact-byte loading and bounded admission when changing the runtime; measure real model memory and recall manually before changing these limits.

## DN-21: Complete result delivery and bounded retention

- **Type**: Result integrity / lifecycle and resource constraint.
- **Status**: Active (2026-11-16).
- **Location**: `result-delivery.ts`, `result-receipt.ts`, `job-runner.ts`, `write-bounds.ts`, `scholarly/fulltext/store.ts`.
- **Behavior**: Oversized results require a complete attachment and a bounded receipt. Storage failure fails explicitly; background jobs cannot substitute full or truncated bodies. Foreground promotion publishes one attachment, and unpromoted candidates do not copy their bodies into job outcomes. Receipts retain the latest 128 deliveries per session and 1,024 globally by publication time; call/job aliases expire together. Host-owned attachments remain available to historical session references after receipt eviction. Invalid receipts are individually backed up and isolated. Unmount closes admission and waits at most five seconds. Accepted publications retain domain handles until settlement, then close them; late producers that have not entered publication fail explicitly. Browse cards retain a complete prefix of at most 20 rows within a 6 KiB row budget, counting JSON separators. Actual page counts and continuation remain intact; `omitted` reports hidden rows without changing canonical results. Every write checks scalar bounds before plan assembly and service approval, and encoded HTTP bodies are limited to 1 MiB without truncation. Scholarly text expires from memory and disk after seven days; writes reclaim old records to maintain 256 entries and 128 MiB.
- **Review trigger**: Changes to host attachment collection, domain closure, job outcomes, write bounds or cache lifetimes.
- **Verification**: `result-persistence`, `result-retention`, `result-unmount`, `result-jobs`, `export-delivery`, `write-bounds`, `fulltext-cache`.
- **Follow-up**: Recheck file ownership when the host offers reference-counted collection. Preserve failure, deadline, restart-ordering and late-settlement regressions.

## DN-22: Disclosure acknowledgement belongs to one component mount

- **Type**: Component authorization / upstream lifecycle constraint.
- **Status**: Active (2026-11-16, pin `0.2.2-rc.3`).
- **Location**: `component-enablement.ts`, `remote.ts`, `client/enable-notice.ts`, `client/status-probe.ts`.
- **Behavior**: Each scholarly/enrichment service construction generates a random UUID, isolated by the Cordis `ctx.root` identity. Status exposes only current mounts; an older mount's cleanup cannot revoke its successor. The browser persists that identity as its acknowledgement, so re-enabling while offline, restarting the host and switching hosts all disclose again. Only the explicit acknowledgement button accepts; Escape and backdrop clicks keep the notice open. Identity is read once per served period. A failed read still discloses and acceptance lasts only for the current browser session. Status probes have a 30-second deadline; disposal cancels them and rejects late results.
- **Review trigger**: Cordis root identity, component remounts, status endpoints, plugin-manager state or disclosure wording changes; specifically review upstream's experimental `ctx.root` contract.
- **Verification**: `component-enablement`, `enable-notice-epochs`, `enable-notice-storage`, `enable-notice`, `status-probe` and client `apply` cover host isolation, offline re-enabling, old cleanup, storage refusal, stale asynchronous responses and explicit acceptance.
- **Follow-up**: Migrate to a stable upstream component-mount identity if published and remove this WeakMap. Preserve cross-host, offline re-enable and cleanup-race regressions.

## DN-23: Private artifact roots and content digests

- **Type**: Evidence integrity / local filesystem boundary.
- **Status**: Active (2026-11-16).
- **Location**: `enrichment/safe-directory-path.ts`, `output-dir.ts`, `artifact-schema.ts`, `artifact-store.ts`.
- **Behavior**: POSIX artifact roots must belong to the current user and deny group/other writes. Shared temporary roots cannot directly hold artifacts; owned private children are allowed. Ancestors must belong to this user or root, or have sticky protection; every ancestor writable by other users must have sticky protection. New directories use 0700. Windows ACLs are not inferred from POSIX uid/mode. Committed metadata records SHA-256 for Markdown, the optional content list and every image; reads verify digests and existing byte/character bounds. Private roots prevent another account from forging index, metadata and document together; digests detect equal-length replacement of committed files. Older artifacts missing digests fail explicitly without migration or silent repair.
- **Review trigger**: Directory admission, OS permissions, cache formats, file I/O or image metadata changes.
- **Verification**: `enrichment-output-dir`, `enrichment-artifact-format`, `enrichment-artifact-store` cover shared roots, foreign ownership, unsafe ancestors, sticky temporary parents and equal-length text/image tampering.
- **Follow-up**: Preserve both ownership checks and content digests. Native Windows ACL admission requires platform verification; POSIX tests do not establish it.

## DN-24: Upstream mirrors, static registration and search-fold equivalence

- **Type**: Upstream contract / upgrade verification.
- **Status**: Active (2026-11-16, Harness pin `0.2.2-rc.3`; Zotero 10.0.2-beta.9 source contract, reverified against 11.0-beta.4+045d52044).
- **Location**: `fiber-state.ts`, `service.ts`'s `LOGGER_LEVEL` and dynamic write registration, `typert.ts`, `wire-schemas.ts`, `search-text.ts`, `scripts/verify-zotero-search.mjs`.
- **Behavior**: Cordis const enums have no runtime object to import. FiberState and LoggerLevel use type-anchored numeric mirrors; the exhaustiveness table catches added states. The Typert generator requires a monorepo layout, so this standalone package derives host members and the browser namespace from one strict descriptor table and registers its manifest once. Write tools register dynamically because panel `tools.execute` supplies no toolSet; `when` cannot replace registration ownership. Search folding must be compared with the actual Zotero mapping, formatting-tag expression and normalizeForSearch together in `chrome/content/zotero/xpcom/utilities_internal.js`. Environment reuse is DN-14, graph and non-atomic writes are DN-19, and external resource ownership is DN-11.
- **Review trigger**: Harness pins, Cordis state/logger enums, tool execution semantics, Typert generator layout, Zotero upgrades or changes to `search-text.ts`.
- **Verification**: `npm run typecheck`, `typert-parity`, client Remote contracts and write-policy tests. After every Zotero upgrade run `node scripts/verify-zotero-search.mjs --archive /Applications/Zotero.app/Contents/Resources/app/omni.ja --report /tmp/zotero-search-equivalence.json`; other platforms can pass `--source <extracted utilities_internal.js>`. It extracts actual definitions, compares every Unicode scalar plus fixed and deterministic mixed corpora, and records source/mirror digests. The current 1,132,075 cases agree without network access.
- **Follow-up**: Delete mirrors when runtime enums become available; migrate when standalone Typert generation is supported; reassess dynamic registration if panel execution gains a toolSet. On a search mismatch inspect the actual source version, update the mirror and independent regression samples, then rerun. Never generate expected results from the mirror.

## DN-25: Fulltext index listings and library cursors use independent counters

- **Type**: Zotero protocol / integrity constraint.
- **Status**: Active (2026-11-16).
- **Location**: `local/changes-domain.ts`, `changes-contract.ts`, `docs/tools.md`.
- **Behavior**: The installed server_localAPI.js FullText GET requires since and filters SQL by FI.version. A library transaction counter cannot stand in for it. Explicit fulltext requests use since=0 to read the complete index listing, report index versions and issue no library delta cursor. A derived trash split requires both input listings to be complete; missing live rows never prove deletion.
- **Review trigger**: Zotero FullText SQL, cursor types or trash fallback changes.
- **Verification**: `changes` checks since=0, independent versions and incomplete derivations; the live read-only GET returned 579 valid entries. Protocol source is `chrome/content/zotero/xpcom/server/server_localAPI.js` inside Zotero app/omni.ja.
- **Follow-up**: If upstream unifies counters or provides a separate fulltext cursor, add it against verified protocol evidence. Preserve counter separation and completeness regressions.

## DN-26: Durable trail state stores facts consumed by the fold

- **Export location constraint**: Domain, presentation and trail share `ZoteroExportItem`: text bounds appear together or are both absent. Wire rejects incomplete, negative, fractional, empty or reversed spans; replay decoding drops invalid location rows. Presentation never emits half a pair. `source-export-locations`, tool output schemas and client selectors cover this boundary.
- **Type**: Persistent format / projection lifecycle.
- **Status**: Active (2026-11-16).
- **Location**: `session-projection/source-ledger.ts`, `sources/event-ledger.ts`, `sources/model.ts`.
- **Behavior**: Projection state version 3 contains only the chunked ledger and removes unused inheritedEventCount. Its strict schema refuses obsolete extra fields; the host rebuilds current state by replaying session events. Inherited events still fold normally. Search tools forbid includeTrashed, so trail occurrences no longer declare that unavailable capability. Production reads use the incremental SourceWorkspaceIndex; tests read the actual projection instead of retaining a separate full replay implementation.
- **Review trigger**: Persistent fields, strict schemas, event retention or projection versions change.
- **Verification**: `source-ledger-projection`, `source-projection-incremental`, `source-ledger`, `source-page` cover replay, inherited events, stable snapshots and complete paging.
- **Follow-up**: Bump stateVersion with every format change and verify host event replay. Every new persistent field requires an actual consumer.

## Retired entries

A retired entry keeps its original title, retirement date, and replacement mechanism, so the history of why the workaround existed stays traceable.

### DN-6: The explain draft carries the artifact's Markdown path

- **Type**: security boundary / other development constraint.
- **Status**: retired (2026-11-15, effective with this change).
- **Location**: `explain` and `parsedExplainPrompt` in `ParsedDocumentTab.tsx`, the addresses in `parsed-tab.ts`, `mode="fulltext"` in `tools/retrieve.ts`, the window branch in `local/retrieve.ts`, and `lookupArtifact` and `DocumentCache` in `enrichment/service.ts`.
- **Behavior**: the original implementation sent the artifact's **absolute Markdown path** (`<outputDir>/<cacheKey>/full.md`) over the wire so the browser could ask the model to read that file before explaining a selection. `zotero_retrieve` then returned ranked passages only, and URL-sourced artifacts had no item ref, so the path was the only locator that reached the whole paper. `zotero_retrieve` now has `mode="fulltext"`, which reads a complete document through paged windows addressed by `source` (an attachment ref or an `artifactId`), with windows sized under the inline delivery budget by default (a lowered `maxInlineResultBytes`/`maxInlineResultTokens` can still force file delivery). The explain draft asks the model to call that tool from `start=0` and follow `nextStart` with the `continuation` token until `isTruncated` is false, then explain the passage. `documentPath` is gone from the wire, the metadata view and the store, so the browser never sees a host path. The whole request is still **one** `insertQuote` card (splitting into `insertText` + `insertQuote` leaves loose plain text above the bubble, a change that was tried and reverted), and the model-facing copy stays fixed English, identical in both dictionaries, and states the writing contract: answer in the conversation's language, lead with one plain sentence, define terms on first use, separate the paper's claims from the reading, and say so when the full text cannot be read. Full reads go through the read-only `FulltextEnhancer.lookup` / `lookupArtifact` arms and never start a parse, download or upload; the session trail folds the call into its own "fulltext read window" fact (each fact is one window, not a claim that the whole document was read). On a long document, the first window also carries a `spillRef` when the host provides spill storage: a one-handle copy of the whole bounded text. The window chain does not depend on it; without a store the field is absent. Each window is an independent call, and the core keeps no cross-call state. Parsed-artifact reads are served through the enhancement side's service-instance document cache (`DocumentCache` in `src/enrichment/service.ts`: two entries, 64 MiB, a 120-second idle TTL, keyed by artifactId plus the store's write counter; every store write changes the key and a discard retires the entry), so repeated windows of one artifact often need no file I/O at all. An attachment-ref read still revalidates the source and re-reads the whole document. The chain carries a server-issued `continuation` fingerprint (source identity, bounded length and SHA-256 of the text); a source or generation change is refused to preserve generation boundaries.
- **Review trigger**: revisit when `zotero_retrieve` fulltext mode or `lookupArtifact` semantics change, when the Host's `insertText` / `insertQuote` semantics change, when the Host offers an instruction-card container, or when fulltext windows move to file delivery. Verify then that the model still reaches the whole document, the composer still holds one removable block, and the trail still records the window read.
- **Verification**: `tests/tools/retrieve-fulltext.spec.ts` asserts inline delivery and mode exclusivity; `tests/local/retrieve/retrieve-fulltext.spec.ts` asserts lossless window joining, artifactId addressing, miss/fault and truncation; `tests/host/source-ledger-fulltext.spec.ts` asserts the trail fact; `tests/client/library/parsed-document-details.spec.tsx` and `parsed-document-selection.spec.tsx` assert the draft names `mode="fulltext"` and `source`, carries no path or leftover placeholder, and does not use `insertText`; `tests/host/enrichment-artifact-metadata.spec.ts` asserts the wire no longer carries `full.md`.
- **Follow-up**: retirement note — the original "if the model gains a tool that reads an artifact by id, drop `documentPath`" condition is now satisfied. If the Host ever prevents model-initiated tool calls, re-audit the "draft instructs the model to call a tool" entry point and the trail-visibility verification with it.

## DN-27: Close tool parameter names before execution

- **Type**: Host contract / parameter integrity.
- **Location**: `define-tool.ts`, `parameter-correction.ts`, and every local and scholarly tool definition.
- **Behavior**: The rc.3 parameter DSL produces an open root object. The shared constructor advertises `additionalProperties: false` and uses the host's `validateJsonSchemaValue` and `ToolArgsError` to reject unknown root names before any tool executes. The host's `defineTool` still validates declared values; field validation is not reimplemented. Unique approximate matches cover both missing required and optional names, without guessing ambiguous matches. Dynamic background parameters are available only while actually registered.
- **Review trigger**: Host tool DSL, pipeline or argument-error upgrades; new tools or dynamic parameters.
- **Verification**: `tool-parameter-closure` checks all 30 actual registrations and refusals without side effects. `parameter-correction` checks hints through the real pipeline. Local and scholarly behavior tests cover accepted execution.
- **Follow-up**: Use the native capability when the host exposes closed parameter roots, remove the local root-name refusal branch, and retain real-call and unknown-optional-key regressions.

## DN-28: Helper ratchets track current line counts

- **Type**: Test infrastructure / regression gate.
- **Location**: `scripts/test-lint.mjs`, `scripts/test-lint.d.mts`, `tests/README.md`.
- **Behavior**: Each existing helper baseline must equal its current measured line count. Shrinking a file without lowering its baseline also fails, preventing later growth back into old headroom. Deleted files require removal of their entries; new helpers cannot enter the existing baseline.
- **Review trigger**: Splitting or shrinking an existing helper, or changing line measurement or gate baselines.
- **Verification**: `tests/unit/tooling/test-lint.spec.ts` covers an unchanged baseline after shrinkage, successful synchronized lowering, refusal of subsequent growth, and stale paths.
- **Follow-up**: Keep lowering baselines when splitting helpers and retain independent tests of the gate itself.

## DN-29: Public test support and registry entry differences

- **Type**: Upstream assembly constraint / dependency pin.
- **Location**: `tests/helpers/lanes/host-lane.ts`, `tests/client/helpers/mock-translate.ts`, `scripts/test-lint.mjs`, `scripts/harness-state.mjs`.
- **Behavior**: The host lane uses public `executeModelToolFixture`, retaining the actual pipeline, call id, agent and signal. Locale fixtures use the explicitly exported and published `dsh-client-test-runtime/src/translate.ts` without copying its algorithm. That translation entry and the three independent whole-client assembly entries have an exact test-support source allowlist; the package explicitly publishes them, and exports, files and actual paths are verified. The rc.3 full runtime root imports loader-only `/client` artifacts. `client-test-platform.mjs` maps those entries to explicitly published production source using each package's declaration path and fails when the source contract or file is missing. Vitest deduplication prevents its nested Vitest 4 from splitting this repository's Vitest 5 runtime. The slot-runtime and resource composition tests now create, use and dispose public `SlotTestRuntime`; migration of the entry's recording fake remains incomplete. A separate resource case executes the physical compiled bundle to retain publication coverage. The pin script adds exact harness overrides from direct declarations and the current lock closure before npm regenerates the lock.
- **Review trigger**: Test-support, client module loader, runner or pin-writer changes.
- **Verification**: Actual host/tool calls; `harness-state` tests pin new direct and transitive packages; `test-lint` proves the pure entry is published and other source paths remain refused; locale, client DOM and complete release checks.
- **Follow-up**: Remove published-source mapping and the corresponding entry exceptions when upstream provides directly executable ESM `/client` entries. Preserve real assembly, payload validation and unified disposal; local doubles serve explicit fault injection only.

## DN-30: Client platform contracts and UI verification follow the pin

- **Type**: Host browser module contract / version review.
- **Location**: `client-graph-authority.mjs`, `build-client.mjs`, `harness-state.mjs`, `shared/harness-doc-pin.mjs`, `smoke-parsed-ui.mjs`.
- **Behavior**: Browser externals have one source. With a sibling checkout, the gate parses the pin tag's actual `PLATFORM_MODULES` TypeScript AST and rejects each unavailable external; comments, strings and dynamic spreads cannot prove availability. Registry-only checks without a sibling retain fixed-input guard tests and cannot claim an upstream platform read occurred. Manual Chromium verification reuses `pinnedHarness` / `pinThemeSheets` instead of carrying a version literal. The rc.3 theme was exercised across two sizes, light/dark themes and three production components, totaling 12 layouts. The production `ParseDocumentDialog` fixture must receive the merged host translator, rather than the removed locale fallback. Component mount failures record DOM, browser errors and screenshots. The pin writer synchronizes README badges, installation requirements and skill commands; check mode refuses stale examples. Dated historical constraints retain their original verification version.
- **Review trigger**: Host platform, dependency pin, external-module or UI fixture changes.
- **Verification**: `client-graph-authority` mutation tests remove every external; `harness-doc-pin` covers stale/missing markers and idempotence; `harness:check` reads the actual tag; `smoke-parsed-ui.mjs` reports layouts, browser errors and generation replacement behavior.
- **Follow-up**: Repeat platform, token snapshot and Chromium checks on upgrades. Keep failure screenshots and runtime errors visible instead of substituting an old theme or silent mock.

## DN-31: Hard model deadlines are proved by worker exit

- **Type**: Local inference / lifecycle and resource ownership.
- **Location**: `enrichment/semantic/loader.ts`, `worker-embedder.ts`, `model-worker.ts`, `worker-runtime.ts`, `session.ts`.
- **Behavior**: Each model instance’s bundle verification, tokenizer and ONNX session belong to a separate thread. The 180-second opening and 120-second inference deadlines terminate the thread. Opening fails only after confirmed exit, so serialized model switches can continue. Caller cancellation preserves its original reason; late replies are still consumed and cleaned up. The last scope aborts an unowned opening, and abandoned queued targets never open. Returned vectors are checked for count, Float32 type, dimension and finite values. A terminated resident is explicitly unavailable; the next scope opens a fresh instance, while an old scope cannot borrow a replacement model.
- **Review trigger**: ONNX/WASM, Node Worker, opening/inference deadlines, model switching or vector-cache lease changes.
- **Verification**: `semantic-worker-lifecycle` uses real threads with uncooperative loops and message channels, without models or network access, to verify actual exit, queue recovery, cancellation/late replies, malformed vectors and reopening. Existing loader/ownership tests retain fixed-instance lease coverage. Pack smoke executes the emitted worker from a real npm tarball and verifies a missing bundle is refused before runtime loading.
- **Follow-up**: Reassess isolation if ONNX provides provable hard cancellation and complete resource release. Do not substitute a race that leaves a stalled runtime alive. Actual model speed and quality measurements remain separate manual acceptance; protocol tests are not model-quality evidence.

## DN-32: Parse failure receipts and durable task recovery

- **Type**: Redaction / durable task recovery.
- **Location**: `enrichment/parse-target.ts`, `transport.ts`, `parse-once.ts`, `artifact-store.ts`, `parse-jobs.ts`, `service.ts`.
- **Storage**: Session operation receipts and generation pointers live at the independent `$DSH_HOME/zotero-receipts/parse-jobs/` root. Artifact `outputDir` changes cannot move them. `enrichment-receipt-location` uses real disk to verify the original receipt remains readable after changing directories and remounting; restarting the same operationId under different configuration stays an explicit conflict.
- **Behavior**: Redact URLs, paths and credentials from the complete error before bounding it to 256 characters. Long messages retain their diagnostic beginning and recovery instruction at the end. Uploaded and not-yet-uploaded tasks expire after 24 hours; an explicit parse removes an expired task and submits afresh. Poll exhaustion removes the resumable receipt. Invalid JSON or a failed task schema is removed before treating the task as absent; read/delete permission and I/O errors remain explicit. Idempotent replay after restart returns `joined` or `completed`, never a fictional newly started job.
- **Review trigger**: Error formatting, task persistence, MinerU retention, polling budgets or replay protocol changes.
- **Verification**: `enrichment-parse-failure-receipt` checks POSIX, Windows and UNC paths, persisted content and long fake-IP guidance. `enrichment-task-recovery` covers expired uploads, resubmission after poll exhaustion, corrupt records and failed removal permissions. The persistence spec verifies replay creates no new job.
- **Follow-up**: Review the 24-hour bound when MinerU retention or its protocol changes. Preserve explicit submission: ordinary reads cannot upload as a side effect of recovery.

## DN-33: Admission evidence and measurement scope

- **Type**: Model quality / research evidence provenance.
- **Location**: `semantic/model-profiles.ts`, `scripts/semantic-calibration/*admission*`, `tests/fixtures/semantic-admission/`.
- **Behavior**: All six models were actually encoded through the production worker on 2026-11-17. Raw vectors, full model identities, input digests, runtime environment and per-case measurements are archived together. Automated tests recompute policies from those vectors without running models. The authored regression set has 24 cases, including 20 paraphrases and four controls; English uses 12 and ten respectively. Paraphrase and full-set BM25 denominators stay distinct. Margins are fixed policy limits, not independently fitted optima. The same vectors reproduce two unrelated hits under hybrid's old 0.461 floor; the corrected 0.509118 floor keeps this set's recall unchanged and removes its answer-removed control hits.
- **Review trigger**: Model revision, tokenizer/prefix, pooling, runtime, dataset text, floor or margin changes.
- **Verification**: `semantic-admission-measurement.spec.ts` checks file digests and recomputes every cosine, ranking, metric and profile. Mutations cover stale digests, duplicate keys, invalid dimensions and synthetic markers. The historical logistic runtime-report is separate diagnostic metadata and does not prove current policies.
- **Follow-up**: Re-measure with prepare-admission → encode-admission → measure-admission. Review proposals and support limits before updating policies and all archived evidence. This small same-set regression does not establish real extraction, external annotation, heldout effectiveness or production false-positive guarantees; product claims must retain that scope.

## DN-34: React hook gates and script type checking

- **Type**: Development constraint / regression boundary.
- **Location**: `eslint.config.mjs`, `tsconfig.scripts.json`, `scripts/harness-state.mjs`.
- **Behavior**: Client source and browser tests run `rules-of-hooks` and `exhaustive-deps`; every warning fails `lint:hooks`, which the release gate must invoke. Babel parses TypeScript and JSX without TypeScript 7's removed Compiler API; `.ts` retains its non-JSX parsing semantics. Capability decisions belong at component boundaries and cannot change the hook sequence inside a component. Mutable sources tied to a session or connection retain their scope identity while their contents update.
- **Scripts**: The model-download CLI implementation runs under `checkJs`. Upstream dependency discovery parses syntax trees across JS/TS module variants in `src/`, `tests/`, and `scripts/`; comments and quoted examples never become dependencies.
- **Review trigger**: React, ESLint, Babel or TypeScript upgrades; new script calls to host APIs; capability gates or persistence timing changes.
- **Verification**: `tests/unit/tooling/react-hooks.spec.ts`, `harness-artifacts.spec.ts`, client tests, `npm run lint:hooks`, and `npm run typecheck`.
- **Follow-up**: Add implementations of new standalone CLIs calling host APIs to script type checking. Retain conditional-hook, missing-dependency, and generic-arrow counterexamples when upgrading the parser.

## DN-35: Isolate browser declarations from host execution types

- **Type**: Type boundary / test ownership.
- **Location**: `types.ts`, `write-call.ts`, `job-kinds.ts`, `error-codes.ts`, `fulltext-spill.ts`, `result-contract.ts`, `tsconfig.client*.json`, `scripts/client-declarations.mjs`.
- **Behavior**: Shared DTOs import no host execution context, augment no host `JobKindMap`, and reference no fulltext implementation through the spill callback. Host entries own write approval context and job kinds. Browser source compiles without Node globals; browser tests compile in a separate program with Node test-platform types. The declaration gate inspects actual compiler-resolved files and refuses host jobs/tools/agent root entries and local host execution modules independently of `skipLibCheck`. Client jobs use their public type directly; connection, which declares no Context property, is obtained through Cordis strict service lookup.
- **Tests**: The host pipeline produces four scholarly write receipts and compares them exactly with archived JSON. Browser tests replay their complete content and meta without merging both Context worlds into one program. Updating the capture requires explicitly running the capture spec with `DSH_CAPTURE_SCHOLARLY_RECEIPTS=1`; ordinary tests only compare.
- **Review trigger**: Host imports, Context augmentation or implementation references in shared types; tool output changes; TypeScript or host jobs contract upgrades.
- **Verification**: `client-declarations.spec.ts` checks the real browser graph and rejects an actual compiler program importing host job kinds; scholarly receipt capture, browser receipt and write-card tests; `npm run typecheck`.
- **Follow-up**: Keep shared contracts separate from execution. Cross-boundary tests verify host production and browser replay against the same exactly compared capture.

## DN-36: Default annotations in tool schemas

- **Type**: Upstream contract.
- **Location**: `tools/search.ts`, `tools/retrieve.ts`, and pinned `dsh-tools/src/schema.ts`.
- **Behavior**: Harness defines `default` as a non-validating JSON annotation and never fills arguments from it. Tools apply their business defaults and validate mutually exclusive arguments by presence; omitted retrieve mode currently means evidence. `Object.hasOwn` cannot distinguish model input from a future validator's inserted own properties and cannot provide compatibility with default filling.
- **Review trigger**: Harness schema authoring or argument-validator upgrades.
- **Verification**: Real search and retrieve-fulltext pipeline cases cover omitted `tagMatch`, omitted mode, fulltext argument exclusivity and invalid ranges.
- **Follow-up**: If upstream changes default semantics, update default annotations affecting exclusivity and normalization together and verify them in the upgrade. Current code must not assume filling behavior.

## DN-37: Style gates inspect CSS semantics

- **Type**: Development constraint / presentation boundary.
- **Location**: `scripts/shared/css-syntax.mjs`, `scripts/style-guard.mjs`, `tests/unit/tooling/style-syntax.spec.ts`.
- **Behavior**: CSSTree parses rules, declarations, values, selectors and media conditions through one authority. Tokenization preserves offsets and recognizes CSS escapes; comments, semicolons and brackets inside strings never split structures. Literal typography is checked inside var fallbacks and calc and must use host scale values. Color checks include named colors, modern functions and var fallbacks; transparent and currentColor retain their structural meaning. A media exception must definitely reject the opposite capability; OR and not cannot widen hover or touch-font exceptions. Motion restricted to no-preference is valid; otherwise reduced motion must actually disable each transition/animation across the whole subject and media scope.
- **Review trigger**: New CSS syntax, host style rules or CSSTree upgrades.
- **Verification**: Existing style-guard tests and style-syntax counterexamples cover escapes, structure, named colors, relative typography, logical borders, corner longhands and media logic; `npm run style:check`.
- **Follow-up**: Extend the shared parser with paired valid and bypass cases; never widen policy exceptions merely to restore a passing gate.

## DN-38: Dependency and runtime release identity

- **Type**: Supply provenance / release boundary.
- **Location**: `scripts/shared/onnxruntime-release.json`, `onnxruntime-LICENSE`, `vendor-onnxruntime.mjs`, `harness-state.mjs`, `published-declarations.mjs`, `verify-pack.mjs`.
- **Behavior**: The independent ONNX 1.31.1 anchor uses the official npm tarball's SHA-512 metadata. The actual archive passes that SRI before extracting SHA-256 identities for three assets. The corresponding upstream license is acquired and hashed separately. Vendoring and pack verification compare the independent anchor, so changing assets together with generated provenance still fails. Upgrades require reacquiring and reviewing the upstream archive and license; never derive a new anchor from the installation tree. Direct runtime dependencies use exact versions. Installation claims cover the release-checked closure, and the host still checks future transitive resolutions. Vendored harness versions come from the immutable pin tag; lock resolutions must equal the declared floor, not merely satisfy a wider range.
- **Declarations**: Every packed static import, export and import-type dependency requires consumer dependencies, optionalDependencies or peers; dev dependencies cannot fulfill that contract. Missing client artifacts, corrupt manifests, missing tags and missing files inside existing tags have separate diagnostics; retired harness names fail the gate.
- **Review trigger**: ONNX, harness, runtime dependency or published declaration upgrades.
- **Verification**: Coordinated asset/provenance tampering and license-content cases; real temporary Git pin/working-tree divergence; lock-version counterexamples; declaration dependency checks and actual `verify:pack`.
- **Follow-up**: Refresh independent source evidence before running the full release gate. Review version, SRI, file hashes and license together.

## DN-39: Trail PDF leases and client ownership

- Type: lifecycle constraint. Location: `src/client/url-pdf-readers.ts`.
- Behaviour: catalog version 2 persists file refs only, with at most 256 entries. Leases belong to the current browser session. Replacing an address takes ownership of the new lease before releasing the old one; late release completion cannot remove the replacement. Detaching catalog metadata retains cleanup ownership. Concurrent disposal shares one cleanup result.
- Review trigger: host tab restoration or reading-file lease protocol changes.
- Verification: replacement, persistence refusal, restoration and concurrent disposal cases in `tests/client/library/pdf-reader-lifetime.spec.ts`.
- Follow-up: adopt cross-session lease ownership only when the host defines that protocol; preserve session ownership until then.

## DN-40: Private host route adapter for the deliverable action

- Type: upstream presentation adapter. Location: `DeliverableZoteroAction.tsx`.
- Behaviour: the pinned `deliverables.file.actions` owner supplies no file path. The button accepts only `api/present.open` with exactly one `sessionId`, positive integer `seq` and nonnegative integer `index`, then resolves the delivered file through ChatSnapshot. The client logger reports unsupported routes or coordinates. The file context menu remains available. This adapter is not a public host URL contract.
- Review trigger: harness pin, present-open route or slot owner props changes.
- Verification: `tests/client/deliverables/`; run `npm run smoke:web-composition` before release.
- Follow-up: adopt a public file path or identity once supplied upstream, and remove the parser and this constraint.

## DN-41: Versions covered by client platform validation

- Type: version validation boundary. Location: platform module table, harness pin and browser composition probe.
- Behaviour: named exports, types and the real SlotTestRuntime are verified against the exact pin. The `engines.dsh` interval does not demonstrate testing of every host version in that interval. Every release and host upgrade requires `npm run smoke:web-composition`, with its report and console errors retained.
- Review trigger: host upgrade, platform dependency or client value import changes.
- Verification: `harness:check`, real client runtime tests, `smoke:web-composition` and feature DOM tests cover their respective boundaries. The browser probe does not replace acceptance of every business control.
- Follow-up: extend measured coverage when the host publishes a cross-version contract matrix; report only the versions actually tested.

## DN-42: Button style ownership and content-row layout

- Type: upstream control layout adapter. Location: `ContentButton.tsx`, `IconButton.module.css` and `control-style-ownership.mjs`.
- Behaviour: the pinned Button exposes fixed block sizes `md` and `sm`, with no intrinsic-content-height option. Multiline literature rows use ContentButton; its sole host override is native `style.height="auto"`. The title, metadata and content padding determine row height, while the host supplies type, horizontal padding, corners, hover and focus. Single-line attachments, section headers and ordinary actions use the host Button directly and retain its native height. Selection decoration belongs to the item frame. Shared IconButton adapter styles own icon geometry and narrow-container icon seats; business styles override neither their colours nor geometry.
- Review trigger: a host content-height or icon-button API, control size changes, or a new control wrapper.
- Verification: the style gate follows JSX imports and className bindings into CSS rules, refusing feature control geometry, fill, typography and colour overrides. Unresolved dynamic CSS classes fail explicitly. ContentButton permits only `height:auto`; the icon adapter permits only its dimensions and corners. Negative cases cover both restricted adapters. Browser acceptance must exercise long titles, compact density, PDF badges and narrow panels.
- Follow-up: adopt corresponding host layout APIs when supplied, remove the restricted exceptions, and preserve the feature ownership gate.

## DN-43: Result projection and host snapshots

- **Type**: Upstream contract constraint.
- **Location**: `src/result-delivery.ts` and `createSuccessResult` in the host tools pipeline.
- **Behavior**: The host copies and freezes tool values before validation and projection. A WeakMap keyed by the original result cannot carry facts into the final projector. Inline delivery computes facts once in the final `presentationMeta`; file delivery computes them once after deciding a file is required and retains them in its receipt. Event metadata expands a single copy of the facts.
- **Review trigger**: Changes to the tools pipeline, result wrappers or projectors.
- **Verification**: `tests/host/result-projection.spec.ts` runs both arms through the real tool execution pipeline and asserts one projector call, with no nested facts or duplicate session identifiers in metadata.
- **Follow-up**: Review the delivery layer if upstream introduces a retained invocation projection interface; preserve execution tests for both arms.

## DN-44: npm trusted publishing and registry artifact verification

- **Type**: external configuration contract / release constraint.
- **Location**: `npm-release` in `release-branch.yml`, `scripts/npm-registry.mjs`, and npmjs.com's Trusted publishing settings.
- **Behavior**: authorize GitHub Actions on npm with user `Vncntvx`, repository `dsh-zotero`, workflow filename `release-branch.yml`, no environment, and direct `npm publish` allowed. Fields and the filename are case-sensitive. A new configuration needs a successful first publication within two days; recreate it if expired. Only version-tag pushes trigger publication. OIDC requires a GitHub-hosted runner, npm ≥ 11.5.1, Node ≥ 22.14.0 and `id-token: write`. Before publication, only an authoritative registry 404 indicates an unreleased version; an existing version must match SHA-512. After publication, verifying the downloaded registry tarball bytes precedes GitHub Release creation. Public packages from public repositories receive provenance automatically.
- **Prereleases**: npm publication passes an explicit dist-tag: `latest` for stable versions, the first letter-led prerelease identifier (such as `alpha`) for prereleases, and `next` for numeric or `latest` identifiers. GitHub Release creation and updates both use `--prerelease --latest=false`. Prereleases must preserve the stable channel.
- **Review trigger**: workflow rename, repository migration, adding an environment, or changes to npm authentication or registry protocols.
- **Verification**: `tests/unit/tooling/npm-registry.spec.ts` covers conflicting digests, lookup failures, visibility waits and download bytes; `release-branch.spec.ts` constrains the installation matrix and publication dependencies. GitHub Actions validates real OIDC and all three runners.
- **Follow-up**: recreate npm's trusted publisher when bound fields change. Inspect registry state after a post-publication verification failure; changed bytes require a new version.

## DN-45: Import scanner test input size

- **Type**: test performance / CI release constraint.
- **Location**: `tests/unit/tooling/harness-artifacts.spec.ts` and `importedSpecifiers` in `scripts/harness-state.mjs`.
- **Behavior**: syntax and traversal cases use isolated temporary directories covering `src`, `tests`, `scripts`, type and dynamic imports, re-exports, TSX, comments and template literals. Real imports inside template expressions must remain visible. Unit tests avoid repeating a complete AST scan over the growing checkout. Repository type checks and test guards retain their existing scope.
- **Review trigger**: a new scan root, file extension or import syntax, or a parser or coverage-tool upgrade in CI.
- **Verification**: in failed run `44032316431`, the repository scan took 7586 ms and exceeded the default 5000 ms limit. After the fix, run the focused spec and full `release:check`, preserving every existing gate.
- **Follow-up**: add small positive and negative cases when scanner rules change. Measure whole-repository scan performance separately from syntax unit tests.

## DN-46: Directory normalization tests must preserve noncanonical input

- **Type**: cross-platform test contract.
- **Location**: configured model directory cases in `tests/unit/semantic-loader-lifecycle.spec.ts`.
- **Behavior**: construct raw `..` input with explicit path separators. `path.join` removes `..` before the loader sees it and cannot construct that counterexample. A separate case uses `realpath` to supply an already canonical directory. Neither case depends on macOS's `/var` alias.
- **Review trigger**: model directory policy, temporary directory layout or platform changes.
- **Verification**: runs `44034659947` / `44034650470` passed every test but measured Linux branch coverage at 93.59%, below the 93.6% gate. After the fix, run the loader cases and one full release gate, preserving coverage thresholds.
- **Follow-up**: retain both canonical and noncanonical inputs when directory alias or normalization rules change, so the local directory layout cannot accidentally supply branch coverage.

## DN-47: Identity-first fusion and version records

- **Type**: other development constraint / compatibility.
- **Location**: `identityOf`, `identityRelationOf`, `titleVersionMatch`, and `mergePaperInto` in `src/scholarly/normalize.ts`; `fuseRankedLists` and `absorbEntry` in `src/scholarly/fusion.ts`.
- **Behavior**: deduplication keys may only come from strong identifiers (published DOI, PMID, PMCID, arXiv ID); `10.48550/*` is a preprint identity and never conflicts with a published DOI. When a strong identifier kind exists on both sides with different values and no identity is shared, both records must survive, no matter how well their title, authors, and year agree. Without a shared identifier, the title gate requires an identical title token set (at least three tokens), the same first-author surname and given-name initial, and both years present within one. A verified version relationship such as a preprint and its published version becomes one entry, with the published record preferred as primary; a version merge must never overwrite the primary's title, abstract, authors, or retraction state, and the incoming record is stored whole in `ScholarlyPaper.versions`. Retraction propagates only within the `same` relation. Adding a source or identifier requires updating both the identity sets and the counterexample tests.
- **Review trigger**: a new scholarly source, a new or replaced strong identifier, a change to `titleTokens` / `firstAuthorCompatible`, or any change to the `mergePaperInto` field policy.
- **Verification**: `tests/scholarly/fusion-identity.spec.ts` covers a different studied population, same title/different authors, same title/different years, an erratum, a preprint/published pair, conflicting DOIs, a shared PMID with different DOIs, short titles, and title subsets; `tests/scholarly/fusion.spec.ts` and `tests/scholarly/sources/mappers.spec.ts` retain the same-DOI merge and version-metadata assertions.
- **Follow-up**: if a stronger version relation is introduced (Crossref `relation` or OpenAlex `locations`), implement it explicitly in `identityRelationOf` with matching counterexamples instead of loosening the title gate.

## DN-48: External scholarly responses are accepted only by format and identity

- **Type**: security boundary.
- **Location**: `src/scholarly/citation-format.ts` (new), `src/scholarly/tools/cite.ts`, and `src/scholarly/tools/verify.ts`.
- **Behavior**: an HTTP 2xx is not evidence that a citation is valid. `scholarly_cite` must parse the body for the requested `format` and confirm the requested DOI: CSL-JSON must parse, carry a non-empty title, and match the DOI; BibTeX must have an `@type{...}` structure and a matching `doi` field; RIS must carry `TY`/`ER`/`DO`; `text` rejects an empty body and obvious HTML error pages. Any failed validation produces a per-item failure and must never enter the resolved set. Batch output keeps `inputIndex`, `requestedId`, `resolvedDoi`, `status`, and `value`/`reason` in input order, and `issues` uses a 1-based position. `scholarly_verify` never compares title/year/authors for a bare DOI; a full reference compares only the fields it actually supplies, with absent fields reported as `not-compared`; a DOI-only 404 no longer triggers a bibliographic search.
- **Review trigger**: a new citation format, a changed DOI content-negotiation endpoint, a change to the `citations` / `checks` output shape, or a new registry adapter.
- **Verification**: `tests/scholarly/citation-format.spec.ts` covers HTML, empty bodies, broken JSON, DOI mismatches, and missing BibTeX/RIS structure; `tests/scholarly/verify-input-shapes.spec.ts` covers bare DOI, `doi.org` URL, DOI + title, missing author, institutional author, CJK, compound surname, initials, and year boundaries; `tests/scholarly/cite-verify.spec.ts` covers batch order and partial failure.
- **Follow-up**: if doi.org content negotiation starts returning multiple records or a new format appears, implement structural validation and identity comparison in that module before admitting the value as resolved; never accept an unvalidated body because the status was 200.
