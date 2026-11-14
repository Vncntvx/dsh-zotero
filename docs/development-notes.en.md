<p align="right"><a href="development-notes.md"><b>中文</b></a></p>

# Development notes

## Position and scope

This page records development constraints that future changes must revisit, especially upstream-contract workarounds, upgrade-triggered migrations, and behavior boundaries that are easy to miss in the code and tests. Each entry explains why the constraint exists, when to review it, how to verify it, and how to converge the implementation when the condition changes.

This is not a backlog, design discussion, or general implementation guide. Add an entry only when omitting it could cause a regression, an incorrect migration, or an upstream compatibility break. Do not duplicate ordinary TODOs or material already covered by the architecture docs. Keep the Chinese and English pages synchronized whenever an entry changes.

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

## Upgrade review

Every harness pin change walks this page from the top: check whether upstream now provides the requested contract; if it does, migrate and retire the entry in the same change, because a capability that exists while the workaround remains is not an acceptable state. If it does not, update only the pin version and the review date, leaving the workaround untouched.

## Retired entries

None yet. A retired entry keeps its title, retirement date, and replacement mechanism, so the history of why the workaround existed stays traceable.
