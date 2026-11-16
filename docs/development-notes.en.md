<p align="right"><a href="development-notes.md"><b>中文</b></a></p>

# Development notes

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
- **Behavior**: Each read lease belongs to a real peer, session, original Agent and the store fixed at open. Source generations and output-directory changes leave the old snapshot intact. Browser connections can share browserPeer, so explicit release, one-shot deadlines and resource budgets jointly cover closed pages; peer.signal alone is insufficient. Authorization is checked before and after each read; abandoned leases expire. Candidate and displayed versions own separate Blob URLs, and replacement requires complete preparation.
- **Worker**: ZIP extraction, reference analysis and content-list semantic validation run in the Worker. The parent validates the closed message and persistence accepts normalized payloads. Cancellation awaits Worker exit before releasing admission. Published execution uses `lib/enrichment/zip-worker.js`, emitted by the normal build/prepare path. The archive admission's concurrency and queue ceiling come from the configured `artifactReader`; `ParseFlight` must receive that live limits policy, because building it with the defaults silently voids both settings.
- **Review trigger**: Harness resource, peer or invocation upgrades; snapshot policy or artifact format changes; Worker build-path changes.
- **Verification**: `enrichment-read-snapshots`, `enrichment-read-lifetime`, `enrichment-archive-worker`, `enrichment-archive-admission`, and `parsed-document-*` tests, plus the real JS Worker smoke in `verify:pack`.
- **Follow-up**: When upstream supplies connection-level lifetime or resource refresh, verify its semantics before replacing local management; retain source-binding, complete-publication and cleanup regressions.

## DN-3: Two non-atomic commits for a parsed artifact

- **Type**: security boundary / lifecycle.
- **Status**: active (2026-11-14, pin `0.2.2-rc.2`).
- **Location**: `putNormalized` in `src/enrichment/parse-once.ts`, `putSources` in `src/enrichment/parse-document.ts`, `src/enrichment/artifact-management.ts`, `src/enrichment/artifact-target.ts`.
- **Behavior**: the artifact directory (with `meta.json` as its commit marker) and `sources/index.json` are two independent writes. A crash between them leaves an orphan directory with no index record or a dangling index key pointing at a removed directory; one URL parse also publishes up to three alias keys. The inventory must union both views by cacheKey and deduplicate them. A discard must clear every alias key, the task file, the parse receipts for that generation and the in-memory job state, after invalidating read leases bound to the artifact. `documentArtifact`'s `inspect` accepts only concrete targets, requires a live session and may send a HEAD for URLs, so it cannot enumerate; enumeration goes through `probe` — one batched freshness probe per page (bounded concurrency, one index snapshot per batch) whose per-ref semantics match a single-target `inspect`, still never contacting MinerU. `meta.json`'s `sourceUrl` keeps the complete canonical URL (matching the index's `stamp.url`) to recover an orphan target, but it never enters `identity`, receipts, wire results or display fields; list rows carry only `origin/…`. Revisit all three whenever `artifactMetaSchema`, the `parse-once` commit order, or the artifact/index publication order changes.
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
- **Behavior**: `npm publish --dry-run` runs `prepublishOnly` with `npm_config_dry_run=true`, and the smoke's nested `npm pack` inherits that environment and writes no archive at all, so `verify:pack` fails with "npm pack did not produce exactly one tarball". The smoke deletes that one variable from the child environment so the nested pack always produces a real tarball; every other npm setting is inherited unchanged.
- **Review trigger**: run `npm publish --dry-run` again when the release gate's script chain changes, the npm major moves, or this smoke gains another child process.
- **Verification**: `npm publish --dry-run` completes, and its log carries both `archive-worker pack smoke ok` and `verify-pack ok`; a standalone `npm run release:check` still passes.
- **Follow-up**: if npm stops passing dry-run to lifecycle children, or offers an explicit opt-out, delete the environment cleanup but keep the assertion that the smoke needs a real tarball.

## DN-7: The semantic-ranking runtime ships inside the package, never as a dependency

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
- **Behavior**: `lookupArtifact` is the only entry for an opaque artifactId. It hits a read-through cache keyed by `(artifactId, contentFingerprint, parseGeneration, store.writes)`; on a miss it reads the source index and one `meta.json` to recover the concrete source and **never stats or HEADs that source**. The reason is that an artifactId addresses the local artifact, not "does the source still exist": a parsed URL document stays readable offline (the source check was paid at parse time), and deleting the local attachment does not invalidate the artifact. Reading by item ref (`lookup`) still keeps one stat/HEAD, because that path reads Zotero's index text.
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
- **Behavior**: a successful complete build/prepare records digests for the sources, scripts, configuration, lockfile, toolchain and every emitted file. The quality gate creates one artifact with scripts and dev dependencies removed; Web smoke consumes its tarball and publication consumes its directory. Verification binds the source SHA, closed file set, individual digests, tarball digest and packed contents. The publish job checks out without credentials, and the write token reaches only the final push step. Publication targets the project's origin release branch and uses the observed old ref as a CAS lease; source rollbacks and byte changes are rejected.
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
- **Location**: `write-auth.ts`, `write-authorization-budget.ts`, `write-operation.ts`, `local/write-keyed-batch.ts`, `local/write-trash-graph.ts`, `write-plan.ts`.
- **Behavior**: Zotero consumes a single-use key at authentication. Authorization through completed dispatch must be exclusive. The service retains the operation gate and prompt budget across transport rebuilds. The 15-minute deadline starts after approval and includes queueing and authorization; it must preserve a dispatched write's unknown commit state. Native POST accepts existing key/version entries with PATCH merge semantics, at most 50 objects, each committed independently. Dependency layers must settle before their parents. Every receipt proves its index, identity, version and submitted fields; missing or contradictory proof never permits resending. Revocation atomically removes the credentials secret. Approval documents retain complete values and isolate their Markdown syntax.
- **Review trigger**: A Zotero write, grant-consumption or rate-limit protocol change; a credentials atomic-interface change; changes to graph ordering or approval rendering.
- **Verification**: `batch-one-time-grant`, `trash`, `restore-items`, `write-operation`, `write-authorization-budget`, `write-auth`, `plan-literal-values`. Protocol evidence comes from the installed Zotero `server_localAPI.js` implementation of `writeMultipleObjects`, authentication and authorize.
- **Follow-up**: Recheck per-object transactions and grant consumption during upgrades. Retain partial-conflict, missing-receipt, queued cancellation, total-deadline and rebuild-serialization regressions.

## DN-20: Shared model verification and inference admission

- **Type**: Local-file integrity / resource ownership constraint.
- **Status**: Active (2026-11-16).
- **Location**: `enrichment/model-bundle-inspector.ts`, `model-fs.ts`, `semantic/bundle.ts`, `tokenizer.ts`, `batching.ts`, `session.ts`, `vector-cache.ts`, `evidence-query.ts`.
- **Behavior**: Installation, status and loading share exact catalog inspection. Manifest reads cap at 64 KiB before allocation; pinned paths and parent directories reject symlinks. Runtime readers hash the actual byte snapshot consumed by ONNX and JSON parsers, bounded by pinned size. The process verification cache holds at most 16 identities and is cleared on component teardown. Queries and paraphrases cap at 2,000 characters before source I/O; embedding text including its prefix caps at 131,072 characters before encode. One cache generation admits one inference batch at a time. Padded batches split at 32,768 tokens without dropping rows or repeating encoding. Cache identity includes the complete model contract, including tier and token window.
- **Review trigger**: Catalog windows or dimensions, tokenizer allocation, runtime byte-buffer ownership, inference concurrency, or file inspection changes.
- **Verification**: `semantic-bundle`, `semantic-open-ownership`, `semantic-admission-budget`, `semantic-vector-cache`, `semantic-diagnostic-retry`, and `evidence-query-admission`. Tests use tiny real files and controlled session outputs; no repository test loads a model.
- **Follow-up**: Preserve exact-byte loading and bounded admission when changing the runtime; measure real model memory and recall manually before changing these limits.

## Retired entries

A retired entry keeps its original title, retirement date, and replacement mechanism, so the history of why the workaround existed stays traceable.

### DN-6: The explain draft carries the artifact's Markdown path

- **Type**: security boundary / other development constraint.
- **Status**: retired (2026-11-15, effective with this change).
- **Location**: `explain` and `parsedExplainPrompt` in `ParsedDocumentTab.tsx`, the addresses in `parsed-tab.ts`, `mode="fulltext"` in `tools/retrieve.ts`, the window branch in `local/retrieve.ts`, and `lookupArtifact` in `enrichment/service.ts`.
- **Behavior**: the original implementation sent the artifact's **absolute Markdown path** (`<outputDir>/<cacheKey>/full.md`) over the wire so the browser could ask the model to read that file before explaining a selection. `zotero_retrieve` then returned ranked passages only, and URL-sourced artifacts had no item ref, so the path was the only locator that reached the whole paper. `zotero_retrieve` now has `mode="fulltext"`, which reads a complete document through paged windows addressed by `source` (an attachment ref or an `artifactId`), with windows sized under the inline delivery budget by default (a lowered `maxInlineResultBytes`/`maxInlineResultTokens` can still force file delivery). The explain draft asks the model to call that tool from `start=0` and follow `nextStart` until `isTruncated` is false, then explain the passage. `documentPath` is gone from the wire, the metadata view and the store, so the browser never sees a host path. The whole request is still **one** `insertQuote` card (splitting into `insertText` + `insertQuote` leaves loose plain text above the bubble, a change that was tried and reverted), and the model-facing copy stays fixed English, identical in both dictionaries, and states the writing contract: answer in the conversation's language, lead with one plain sentence, define terms on first use, separate the paper's claims from the reading, and say so when the full text cannot be read. Full reads go through the read-only `FulltextEnhancer.lookup` / `lookupArtifact` arms and never start a parse, download or upload; the session trail folds the call into its own "fulltext read window" fact (each fact is one window, not a claim that the whole document was read). On a long document, the first window also carries a `spillRef` when the host provides spill storage: a one-handle copy of the whole bounded text. The window chain does not depend on it; without a store the field is absent. Each window is an independent call: the W windows of one document each revalidate the source and re-read the whole document (no cross-call cache, keeping the read stateless and generation-safe). If that cost matters, add an enhancement-side, generation-keyed document cache rather than caching inside the core.
- **Review trigger**: revisit when `zotero_retrieve` fulltext mode or `lookupArtifact` semantics change, when the Host's `insertText` / `insertQuote` semantics change, when the Host offers an instruction-card container, or when fulltext windows move to file delivery. Verify then that the model still reaches the whole document, the composer still holds one removable block, and the trail still records the window read.
- **Verification**: `tests/tools/retrieve-fulltext.spec.ts` asserts inline delivery and mode exclusivity; `tests/local/retrieve/retrieve-fulltext.spec.ts` asserts lossless window joining, artifactId addressing, miss/fault and truncation; `tests/host/source-ledger-fulltext.spec.ts` asserts the trail fact; `tests/client/library/parsed-document-details.spec.tsx` and `parsed-document-selection.spec.tsx` assert the draft names `mode="fulltext"` and `source`, carries no path or leftover placeholder, and does not use `insertText`; `tests/host/enrichment-artifact-metadata.spec.ts` asserts the wire no longer carries `full.md`.
- **Follow-up**: retirement note — the original "if the model gains a tool that reads an artifact by id, drop `documentPath`" condition is now satisfied. If the Host ever prevents model-initiated tool calls, re-audit the "draft instructs the model to call a tool" entry point and the trail-visibility verification with it.
