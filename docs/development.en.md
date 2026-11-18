<p align="right"><a href="development.md"><b>中文</b></a></p>

# Development Guide

## Repository Structure

```text
src/
  index.ts              # Plugin entry (pure re-export)
  service.ts            # ZoteroService (Cordis service: tool wiring and provider lifecycle)
  service-config.ts     # Transport-rebuild config keys and the LocalApiLimits mapping
  service-lifecycle.ts  # Config commit validation and volatile-update handling
  shell-write-approval.ts # Approval seam for shell commands that write to the local API directly
  subagent-guard.ts     # Subagent write policy: narrows write-tool visibility by session lineage and denies child write calls at execution time
  tool-diagnostics.ts   # Tool execution diagnostics recording
  tool-registration.ts  # Read/write tool registration lists
  skills/               # Host-only research SOP definitions, recipes and component-scoped registration; see skills.en.md for maintenance and verification
  library/              # Literature panel subcomponent (ZoteroLibraryService, config schema)
  library-views.ts      # Bidirectional mapping between the literature panel's wire views and domain requests (including export)
  library-write.ts      # Literature panel write entry: enters the registered tool pipeline and approval seam
  local/provider.ts     # LocalApiProvider (Zotero Local API adapter)
  local/*-domain.ts     # Domain pipelines (search, export, changes, browse, write, and so on)
  local/                # Helper modules: detail, retrieve, retrieve-fulltext, attachment-location, scope-directory, scope-paths, search-index, search-query, item-schema-directory, changes-cursor, item-batch, and so on
  local/write-*.ts      # Write modules: write-domain plus batch, collections, item-lists, library-maintenance, notes, refs, saved-searches, verdicts, deps
  http-client.ts        # HTTP transport (loopback fetch, streaming, and concurrency slot control)
  config.ts             # Configuration schema and validation
  types.ts              # Domain DTOs and type definitions
  contract.ts           # Remote wire protocol surface and constants
  wire-schemas.ts       # Wire boundary zod schemas shared by both halves
  creators.ts           # Creator display formatting (shared by both halves)
  media-types.ts        # Media type constants (shared by both halves)
  diagnostics.ts        # In-process diagnostics ring buffer, entry model, and sink
  wire-schemas.ts       # Strict wire schemas shared by Host and client (zod)
  abort.ts              # The single spelling of the caller-cancellation error (harness TOOL_ABORTED)
  errors.ts             # Error classes and error codes
  json.ts               # Lossless JSON read helpers
  evidence-item.ts      # Passage item projection definitions (shared by both halves)
  browse-rows.ts        # Browse row classification (shared by both halves)
  changes-contract.ts   # Shared wire descriptors for the changes projection
  transport-bounds.ts      # Response-body limits shared by the local and scholarly transports
  transport-diagnostics.ts # Transport-layer diagnostic line recording (request lines, cancellation, and degradation)
  constants.ts             # Constant definitions
  concurrency.ts        # Bounded concurrency controller
  job-runner.ts         # ctx.jobs background-job adapter for the heavy tools
  evidence.ts           # BM25 ranking algorithm
  search-text.ts        # Search folding identical to Zotero normalizeForSearch
  attachments.ts        # Attachment selection and priority logic
  normalize-children.ts # Normalization of note, annotation, and attachment child rows
  normalize-context.ts  # Shared identity and text rules for normalization
  normalize-item-detail.ts # Normalization of item detail and its child listings
  normalize-saved-search.ts # Normalization of saved-search conditions
  normalize-scope.ts    # Normalization of collection/saved-search identity entries
  normalize-search.ts   # Normalization of search hits and shared item facts
  presentation-meta.ts  # Presentation projection for tool results
  refs.ts               # Zotero ref syntax parsing and formatting
  ref-grammar.ts        # Reference syntax validation patterns
  export-items.ts       # BibTeX entry key grammar and field extraction
  export-mapping.ts     # Citation and batch item mapping
  export-limits.ts      # Ref count cap shared by zotero_export and the literature panel export endpoint
  prompt.ts             # Model-facing system prompt
  write-approval.ts     # Two-tier write confirmation (approval policy and plan review card)
  write-auth.ts         # Zotero local write key acquisition and persistence
  write-http.ts         # Local write HTTP request handling
  write-item-rules.ts   # Write fields and update rules (shared by tools and the write domain)
  shell-write-detector.ts # Detection for shell commands that write to the local API directly (a hit becomes one approval; best-effort)
  remote.ts             # Web-side Remote service
  typert.ts             # Typert manifest
  settings-namespace.ts # Settings namespace constants
  tools/                # 23 local model tool definitions (8 read + 15 write)
  tools/degradable.ts   # Degrade rule for write-tool plan previews (degrade only when unreachable or ambiguous)
  client/               # Browser side (settings page, literature trail, literature panel, tool card views)
tests/                  # Unit tests and end-to-end test cases
```

## Documentation assets

Chinese documents under `docs/` are maintained in pairs with their `.en.md` English counterparts, and a change to one side must update the other; terms and boundaries follow [Product model](product-model.en.md).

| Document                                       | Contents                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Getting started](getting-started.en.md)       | Installation, prerequisites, and connection verification                                                                  |
| [Product model](product-model.en.md)           | Two entry points, two UI surfaces, component division, and system boundaries: the single source for naming and boundaries |
| [Features](features.en.md)                     | Conversation capabilities, literature trail, literature panel, writing, and scholarly search                              |
| [Research SOP skills](skills.en.md)            | Eight on-demand research workflows, batch budgets, and evidence boundaries                                                |
| [Tool reference](tools.en.md)                  | 23 local tools (8 read + 15 write) and 7 scholarly retrieval tools                                                        |
| [Configuration reference](configuration.en.md) | Four settings namespaces, 69 fields, and the hot-reload mechanism                                                         |
| [Troubleshooting](troubleshooting.en.md)       | Common issues, causes, and diagnostic steps                                                                               |
| [Architecture](architecture.en.md)             | Data flow, layer responsibilities, and design boundaries                                                                  |
| [Development guide](development.en.md)         | Build, test, debug, and release flows                                                                                     |
| [Development notes](development-notes.en.md)   | Constraints, behavior boundaries, and migrations to revisit during future development                                     |
| [Docs index](index.en.md)                      | Entry point for the reader docs                                                                                           |

Product structure and terminology live in [Product model](product-model.en.md); agent and contributor rules are in `AGENTS.md` at the repository root.

## Installation and Build

```sh
npm install                  # Install dependencies (as a sibling of deepseek-harness)
npm test                     # Unit tests and test specification checks
npm run typecheck            # Type check (Node, host-test, browser, browser-test, and CLI projects)
npm run build                # Compile all artifacts (tsc → lib/, esbuild → lib/client.js)
npm run build:client         # Build the browser artifact only
npm run test:coverage        # Coverage gate check
npm run test:calibration     # Semantic calibration self-check (offline protocol, no model loading)
npm run harness:check        # Check the upstream Harness version pin and artifact consistency
npm run harness:pin -- <ver> # Update every Harness dependency pin together
npm run deps:check           # Query the registry for direct dependencies behind their latest release
npm run verify:pack          # Validate the packed tarball, including the packaged runtime's hashes and license
npm run assets:semantic      # Download and verify the pinned local semantic models into ~/.dsh/models
npm run assets:runtime       # Regenerate the packaged semantic runtime from its dev dependency
npm run smoke -- --profile-dir <profile-dir> # Installed profile + dsh runtime; execute all eight read arms against real Zotero
npm run smoke:scholarly      # Manual online scholarly_get acceptance through production DNS/undici/TLS
npm run smoke:discovery      # Packed artifact → temporary profile (no build approval needed) → dsh web boot probe
npm run smoke:web-composition # Add the browser composition acceptance on top of smoke:discovery
npm run release:branch       # Cut the publishable release branch (manifest-driven)
npm run release:check        # Release gate: format, version pin, tests, types, coverage, build, pack
npm run link:local-harness   # Link the @deepseek-ai/dsh-* dependencies to the sibling checkout
npm run dev                  # Watch Node-side sources and compile incrementally
npm run dev:client           # Watch browser-side sources and bundle incrementally
npm run lint:hooks           # React hook order and dependencies; warnings fail the gate
npm run lint:test            # Run the test specification guards only
npm run style:check          # Client stylesheet guard against the host design token snapshot
npm run tokens:write         # Refresh the style token snapshot after a harness upgrade
npm run test:watch           # vitest watch mode
npm run test:integration     # Read-only integration tests against real Zotero on 127.0.0.1:23119
npm run format               # Run Prettier formatting
npm run format:check         # Check code formatting
```

`prepare` (triggered by `npm install`) builds `lib/` from source; `prepublishOnly` runs `release:check` before a publish can go out.

The parsed reader's snapshots, file reads and Worker behavior are covered by `tests/host/enrichment-read-*`, `enrichment-artifact-*` and `enrichment-archive-worker`; browser resource ownership, complete document publication and interactions are covered by `tests/client/library/parsed-document-*` and `parsed-resource-composition`. `verify:pack` executes the emitted JS Worker from an actual npm tarball. After building, run `node scripts/smoke-parsed-ui.mjs` to check real components in Chromium across light/dark and narrow/wide layouts, selection menus and complete refreshes; remote responses are controlled. `node scripts/measure-parsed-archive.mjs` compares Host event-loop delay for synchronous and Worker extraction of the same synthetic archive containing 128 MiB of figures, writing `/tmp/dsh-zotero-archive-performance.json`. Neither check calls Zotero or MinerU; live uploads still require separate acceptance.

Note: this repository is usually developed next to `deepseek-harness` as a sibling directory. Type declarations are read from the upstream build artifacts through symlinks. When upstream code changes, build upstream first to synchronize the declaration files.

Released `@deepseek-ai/dsh-client-*` packages declare their third-party runtime dependencies in their own `devDependencies` (the shell provides them when bundling) and reference `.module.css` files directly from `lib/`. This repository therefore mirrors those third-party dependencies in `devDependencies` and lists `@deepseek-ai/dsh-client-*` as inlined in `vitest.config.ts`, so the client test lane also runs in an environment with only a registry install and no sibling checkout (CI).

### Upstream artifact freshness check

`npm run harness:check` checks whether upstream build artifacts are stale. The two checks are independent.

1. Declarations versus source: checks that `lib/types/*.d.ts` is newer than the corresponding upstream source, so type checking never reads an interface compiled from outdated source. The remedy is to rebuild the declarations and the Node-side artifacts.
2. Browser runtime versus declarations: checks that a client package's `lib/client.js` is newer than its own client declarations, so the runtime the page loads never lags the declarations the compiler read. The remedy is to rebuild the browser artifacts only.

```sh
pnpm --dir ../deepseek-harness run build             # check 1: rebuild declarations and Node-side artifacts
pnpm --dir ../deepseek-harness run build:lib:client   # check 2: rebuild browser artifacts only
```

Without `--strict`, both checks print a note. With `--strict` (the mode `release:check` uses), both become problems that block the run. A missing declaration file is a problem in both modes, because type checking cannot resolve it at all.

The same script also validates the vendored framework packages: the lower bound of every `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` range in `dependencies` / `devDependencies` / `peerDependencies` must equal the version in the sibling's `vendor/<pkg>/package.json`, and a mismatch fails outright in both modes. These packages do not follow the Harness version pin, and a `^X.Y.Z-alpha.N` lower bound leaves two copies of `cordis` in one profile.

### Pin upgrade checklist

`npm run harness:pin -- <ver>` updates the toolchain snapshot and consumer manifest from the target upstream tag. Refresh both lockfiles, then run `harness:check`. When the upstream tag is available, the check also verifies the source commit and `packageManager`.

```sh
npm install --package-lock-only
npm install --package-lock-only --prefix tests/fixtures/dsh-cli-consumer
npm run harness:check
```

Also review the upstream semantics mirrored in this repository.

```sh
pin=$(node -p "require('./package.json').devDependencies['@deepseek-ai/dsh-agent']")
git -C ../deepseek-harness grep -n -E 'data-plugin-css|ClientBundleRegistration|claimStyles' "dsh-v$pin" -- packages/client/tsdown.client.ts packages/client/modules/src/client
git -C ../deepseek-harness show "dsh-v$pin:packages/client/ui-chat/src/client/contract/chat-nodes.ts" | rg -n 'export function isSettledTool' -A 3
git -C ../deepseek-harness show "dsh-v$pin:packages/client/ui-tool/src/client/tool/models/tool-call-model.ts" | rg -n 'export function resultText' -A 13
```

`isSettledTool` is publicly exported from `@deepseek-ai/dsh-client-ui-chat/client`; `resultText` has no public entry. Both mirrors are reused by the host half, so neither can become a value import. If an upstream implementation changes (especially the empty-content-with-error fallback and the `preparing` decision), update the degradation matrix in `tests/client/presenters.spec.ts` with it.

## Integration Tests

```sh
npm run test:integration
```

Integration tests need a local Zotero running at `127.0.0.1:23119` with local API communication enabled.

## Semantic admission tiers (fixed in code)

Each tier's `floor` (absolute cosine gate) and `margin` (tolerance below the best cosine) live in `src/enrichment/semantic/model-profiles.ts`. An installed bundle works immediately; unknown tiers fail explicitly with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`.

On 2026-11-17, all six pinned ONNX bundles were encoded through the production worker. Raw vectors and the complete report are archived in `tests/fixtures/semantic-admission/`. The authored regression dataset in `tests/helpers/semantic-recall-fixtures.ts` has 24 cases: 20 paraphrases, two lexical and two duplicate controls. Each has eight passages and one labeled answer. The English tier uses 12 English cases, including ten paraphrases. Removing each answer produces a seven-passage unrelated control corpus. This is separate from the five-feature logistic protocol under `semantic-calibration/`.

| Tier        |    floor | margin | Paraphrase cases | Paraphrase recall@4 | Paraphrase MRR | Control corpus hits |
| ----------- | -------: | -----: | ---------------: | ------------------: | -------------: | ------------------: |
| balanced    |    0.427 |   0.12 |               20 |                 90% |            0.9 |                0/24 |
| lightweight |    0.797 |   0.02 |               20 |                 55% |           0.55 |                0/24 |
| bilingual   |    0.515 |   0.12 |               20 |                 90% |            0.9 |                0/24 |
| english     |    0.593 |   0.12 |               10 |                 80% |            0.8 |                0/12 |
| hybrid      | 0.509118 |   0.12 |               20 |                 90% |            0.9 |                0/24 |
| academic    |    0.584 |   0.12 |               20 |                 95% |           0.95 |                0/24 |

BM25 answer recall@4 is 0% on those paraphrase questions. The full regression dataset includes lexical controls, so its BM25 recall@4 is 4/24 (2/12 for English); keep the two denominators separate. Margins are fixed policy limits; this run does not claim independently fitted optimal margins. Every current floor exceeds the strongest measured answer-removed cosine. Hybrid's 0.509118 floor is its measured maximum 0.508117562 plus a 0.001 safety distance, rounded upward to six decimals, replacing the old 0.461 that admitted two controls; paraphrase recall on this set is unchanged.

These are checks on the same regression set, not external annotation, real PDF extraction, heldout effectiveness or production false-positive guarantees. Tiers still miss answers. The report records model identity, input digests, vector-file SHA-256, per-case cosines and semantic/BM25 rankings. Automated tests only recompute archived vectors; they never load models or use the network.

Re-measure through this complete workflow. Encoding is explicit manual model execution; the other steps read local data:

```sh
npm run build
npm run assets:semantic -- --model=<key> --dir=<model-root>
node scripts/semantic-calibration/prepare-admission.mjs > /tmp/admission-input.json
node scripts/semantic-calibration/encode-admission.mjs --request /tmp/admission-input.json --model <key> --dir <model-root> --out /tmp/<key>-vectors.json
node scripts/semantic-calibration/measure-admission.mjs --embeddings /tmp/<key>-vectors.json > /tmp/<key>-report.json
```

The encoder creates its output exclusively; choose a new path for each rerun. Measurement reports include explicit floor/margin proposals and their support limits. Review the per-case evidence before changing policies and updating archived vectors/reports. The logistic threshold from `fit.mjs` does not generate cosine floors. `self-check.mjs` and `validate.mjs` still verify the separate offline fitting protocol.

## Build Artifacts

- Node artifact (`lib/`): compiled by `tsc`, containing service logic, tool definitions, the provider, and the transport layer;
- Browser artifact (`lib/client.js`): bundled by `esbuild`, containing the settings page, the literature trail, the literature panel, and session cards.

## Engineering Constraints

- **Build and release identity**: `scripts/build-state.mjs` records digests of source files, scripts, configuration, lockfile, toolchain, and every artifact after a complete build/prepare; the release artifact is one tarball with scripts, devDependencies, and development-only overrides removed. `release-artifact.mjs`, `release-tar.mjs`, and `publish-release-branch.mjs` bind the source SHA, file closure, per-file digests, tarball digest, and package contents; the publish job uses the read old ref as a CAS lease and rejects source rollback or byte changes. Verified by `build-state.spec.ts`, `release-artifact.spec.ts`, `release-branch.spec.ts`, and `release:check`.
- **Style-token sources**: CI reads the exact lockfile-installed theme sources for dsw/ds, while linked development reads the sibling pin tag; `RUNTIME_SEAMS` in `scripts/style-tokens.mjs` maps each seam to the current pin's setting, CSS definition, or `setProperty` call, and the source table stays closed with the snapshot. Verified by `tokens:check` (inside `release:check`) and `style-tokens.spec.ts`.
- **Client platform manifest**: when the sibling is present, `scripts/client-graph-authority.mjs` reads the pin tag's `PLATFORM_MODULES` through the TypeScript AST and rejects every external the host does not provide; registry-only checks use fixed-input gate tests. Manual UI acceptance reuses `pinnedHarness`/`pinThemeSheets` and records the DOM, console errors, and screenshots. Verified by the `client-graph-authority` mutation tests, `harness:check`, and `smoke-parsed-ui.mjs`.
- **React Hooks and script types**: client sources and browser tests run `rules-of-hooks` and `exhaustive-deps`, and any warning fails `lint:hooks`; Babel parses TS/JSX while `.ts` stays JSX-free; `tsconfig.scripts.json` covers CLI host-API calls, and `typecheck:program` runs after the build emits `lib` declarations. Verified by `react-hooks.spec.ts`, `harness-artifacts.spec.ts`, `npm run lint:hooks`, and `npm run typecheck`.
- **Style gate**: `scripts/shared/css-syntax.mjs` parses rules, declarations, selectors, and media conditions with CSSTree; font literals must come from the host ladder, colours include named colours, modern functions, and variable fallbacks, hover and touch type-size conditions must not match under the opposite capability, and reduced motion must actually set transition/animation to none. Verified by `style-syntax.spec.ts` and `npm run style:check`.
- **Dependency and runtime identity**: ONNX 1.31.1's independent anchor is the tarball SHA-512 from official npm metadata; after the archive passes SRI, the three assets' SHA-256 values are extracted, and the license digest is fixed. Vendored harness versions come from the immutable pin tag and the lockfile resolution must equal the declared floor; every static import/export/import type in a packaged declaration needs a consumer dependency, optionalDependency, or peer. Verified by `vendor-onnxruntime` tampering cases, `harness-vendor-state`, `published-declarations`, and `verify:pack`.

## Local Debugging

### Full Plugin Debugging (with Web UI)

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml "$DSH_HOME/"   # seeds write credentials only; see the note after the block
chmod 600 "$DSH_HOME/.credentials.yaml"
npm run build
dsh plugin --profile web add .
npm run dev &        # Watch Node-side changes
npm run dev:client & # Watch browser-side changes
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

> Note: plugin configuration persists in the current profile's `cordis.patch.yml` (the `zotero` entry). Fill the Zotero connection and similar settings once in the temporary instance's plugin manager, under the **dsh-zotero** configuration area (or copy the `zotero` entry's `config` in from an existing profile's `cordis.patch.yml`).

> Scholarly component: the `dsh-zotero/scholarly` row ships with the package and is off by default, and that row is its only switch. Both local overlay templates (`dev.cordis.yml.example` / `dev-lib.cordis.yml.example`) mount the scholarly component, so local debugging needs no plugin-manager toggle; when debugging in a real profile, enable the row under "Included components" and the tools and settings page take effect without a restart.

### Host-Only Debugging (with HMR)

```sh
npm run build                                    # Initial build of lib/
npm run dev &                                    # Watch and incrementally compile to lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml # Copy the template and fill in the real absolute paths
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

> Note: the `dev-lib.cordis.yml` overlay loads the plugin through its built entry's absolute path (`<absolute-path-to-dsh-zotero>/lib/index.js`), which gives the host half (model tools) restart-free hot reload under the Loader's watch. The Harness client module loader resolves only registered bare package names, so this mode does not load browser-side frontend components (settings page, literature trail, and literature panel). To debug the frontend UI, use the "Full Plugin Debugging" flow above (`dsh plugin --profile web add .` and `npm run dev:client`).

### Diagnostics Panel and Diagnostics Bundle

When investigating plugin runtime issues, turn on "Diagnostic mode" in the configuration area, then read runtime state and logs in the "Diagnostics" card at the bottom of the plugin detail page:

- Log collection and filtering: with diagnostics on, matching entries are collected and kept, with severity filtering available ("Problems" selects warn and error). Entries run newest first, and consecutive duplicate records collapse into one with a repeat count;
- Diagnostic mode: turn on "Diagnostic mode" in the "Advanced → Diagnostics" group of the dsh-zotero configuration area and save, and the detail page bottom shows the diagnostics panel and records detailed troubleshooting logs;
- Frontend crash capture: when a frontend surface (literature trail, literature panel, tool cards, and so on) hits a render crash, the error boundary records the error and names the failing location in the `surface` field (for example `sources` or `tool:zotero_search`);
- Exporting a diagnostics bundle: clicking "Copy diagnostics" produces a text bundle with the plugin version, the Zotero endpoint and version, the debug state, and every buffered record, ready to paste into an issue report.

## Work-Package Number → Test → Acceptance Traceability (WP0 Baseline)

This table is the number → test → acceptance-results mapping required by WP0 item 5, recorded from the current working tree. "Implemented" means the package's protocol/source and behaviour tests exist, without live or effect acceptance. Claims rest on test files present on this machine and checks that were run; live, browser, and model-matrix checks that were not run are marked "Not accepted".

| WP   | Topic                                                          | Behaviour test evidence (specs that exist)                                                                                                                                                                                                                                                                                                                                                                                               | Acceptance result                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0  | Freeze product, protocol, and reproduction standard            | `tests/host/enrichment-api-contract.spec.ts`, `tests/unit/enrichment-preferences.spec.ts`, `tests/unit/enrichment-parse-wire.spec.ts`, `tests/host/doc-examples.spec.ts`                                                                                                                                                                                                                                                                 | Implemented (closed protocol, two-end types, component enablement authorizes document egress, domain codes preserved across the gateway, legacy parsing aliases removed); this table is the number→test→acceptance record                          |
| WP1  | Ordinary reads only reuse parsed artifacts                     | `tests/local/enrichment-enhancer.spec.ts`, `tests/local/retrieve/retrieve-sources.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`                                                                                                                                                                                                                                                                                           | Implemented (read-only `lookup` seam, hit priority / normal miss, negative assertions that startup, PDF opening, and settings saves trigger no MinerU)                                                                                             |
| WP2  | Two explicit parsing entry points and job lifecycle            | `tests/host/enrichment-parse-document.spec.ts`, `tests/host/enrichment-parse-jobs-lifetime.spec.ts`, `tests/host/enrichment-parse-jobs-admission.spec.ts`, `tests/client/enrichment/parse-integration-operations.spec.tsx`                                                                                                                                                                                                               | Implemented (closed-union target, session-owned `ctx.jobs`, cancellation/unmount cleanup, Gateway error classification)                                                                                                                            |
| WP3  | Source identity, parse priority, and Markdown structure        | `tests/host/enrichment-artifact-format.spec.ts`, `tests/scholarly/read/read-artifact-format.spec.ts`, `tests/host/enrichment-source-publication.spec.ts`                                                                                                                                                                                                                                                                                 | Implemented (unified identity / source stamp, Markdown `format`, outline/section, cache invalidation, old plain text no longer shadowing a new artifact)                                                                                           |
| WP4  | Download, installation, directory, and CLI                     | `tests/host/enrichment/model-cli-coordination.spec.ts`, `tests/host/enrichment/model-installation-safety.spec.ts`, `tests/unit/model-download-client.spec.ts`, `tests/unit/enrichment-safe-directory-preflight.spec.ts`                                                                                                                                                                                                                  | Implemented (real stream / lock / symlink and cancellation safety, single bundle verification rule, CLI parity)                                                                                                                                    |
| WP5  | Ranking identity, variants baseline, and output interpretation | `tests/local/retrieve/evidence-ranker.spec.ts`, `tests/tools/retrieve-render.spec.ts`, `tests/unit/evidence.spec.ts`                                                                                                                                                                                                                                                                                                                     | Implemented (caller index preservation, duplicate handle rejection, semantic dedup maps back to every source, monotone variant union, empty-result claims only on explicit `noMatch`)                                                              |
| WP6  | Reject unrelated corpora in semantic admission                 | `tests/unit/semantic-admission.spec.ts`, `tests/unit/semantic-ranker.spec.ts`, `scripts/semantic-calibration/self-check.mjs`                                                                                                                                                                                                                                                                                                             | Actual vectors archived for all six tiers; 20 paraphrases (ten English-only) yield 55–95% recall@4 and zero answer-removed control hits. Manual encoding; automated offline recomputation.                                                         |
| WP7  | Read scopes, transactional model switch, and draining          | `tests/unit/semantic-loader-lifecycle.spec.ts`, `tests/local/retrieve/retrieve-sources.spec.ts`, `tests/scholarly/fulltext.spec.ts`                                                                                                                                                                                                                                                                                                      | Implemented (foreground scope admitted before source I/O and released in `finally`, transactional resident/pending/retired loader, a failed B keeps A, teardown drains)                                                                            |
| WP8  | Inference cancellation, validation, and bounded vector cache   | `tests/unit/semantic-session.spec.ts`, `tests/unit/semantic-tensor.spec.ts`, `tests/unit/semantic-vector-cache.spec.ts`                                                                                                                                                                                                                                                                                                                  | Implemented (single `TokenizedBatch`, signal throughout, output tensor validation, ownership-transfer release, bounded `lru-cache@11.5.3` cross-request cache); measured green on all six real tiers (see "Semantic admission tiers")              |
| WP9  | End-to-end model settings state machine                        | `tests/client/enrichment/enrichment-model-controller.spec.ts`, `tests/client/enrichment/enrichment-model-form.spec.tsx`                                                                                                                                                                                                                                                                                                                  | Implemented (full `RemoteResult` code/details preserved, only `gateway/service-unavailable` means absent, target generations, invalid draft sends no RPC, serial refresh and signal cleanup, zh/en wording in lockstep)                            |
| WP10 | Clean up docs, legacy semantics, and package contract          | `tests/host/doc-examples.spec.ts`, `tests/unit/tooling/client-graph-authority.spec.ts`                                                                                                                                                                                                                                                                                                                                                   | Implemented (12 zh/en doc pairs, legacy semantics removed, error-code tables, semantic admission tiers and this table); source/prebuilt double-install check not run                                                                               |
| WP11 | Layered and real acceptance, issue-by-issue closure            | `npm run test:integration`, `npm run smoke:web-composition`                                                                                                                                                                                                                                                                                                                                                                              | Not accepted (overall acceptance gate; does not replace the live checks below)                                                                                                                                                                     |
| WP12 | Unified parsed-document management                             | `tests/host/enrichment-artifact-management.spec.ts`, `tests/host/enrichment-artifact-target.spec.ts`, `tests/unit/enrichment-parsed-manager-wire.spec.ts`, `tests/client/enrichment/parsed-manager-tab.spec.tsx`, `tests/client/library/library-panel-header.spec.tsx`, `tests/host/enrichment-artifact-metadata.spec.ts`, `tests/client/enrichment/parsed-manager-actions.spec.tsx`, `tests/client/library/parsed-badge-probe.spec.tsx` | Implemented (index/directory union and dedup, orphan/dangling/broken states, discard clears every alias and receipt, complete URLs never enter the wire, artifact addressing, header order and mount gating)                                       |
| WP13 | Whole-document window reads                                    | `tests/local/retrieve/retrieve-fulltext.spec.ts`, `tests/tools/retrieve-fulltext.spec.ts`, `tests/host/source-ledger-fulltext.spec.ts`                                                                                                                                                                                                                                                                                                   | Implemented (refs reuse parsed Markdown first, otherwise index text; artifactId reads URL artifacts; no parsing/download/upload, lossless UTF-16 continuation, complete file delivery above inline budgets, fulltext facts in cards and the trail) |

### Live acceptance not run (needs separate user authorization)

The following were not run this round and are marked "Not accepted". Before running them, obtain the user's authorization for the specific documents under test; simulated component tests do not replace browser acceptance:

- **MinerU free / pro live uploads**: test each with a dedicated synthetic PDF of known content (attachments in an isolated library / test items); without pro credentials or a live service, mark it not accepted.
- **Browser end-to-end acceptance**: pack into a temporary Harness profile and actually operate attachment parsing, top-level attachments, URL parsing, reparse, cancel, reconnect, component switch, and model switch, verifying control permissions, progress, error recovery, narrow-screen/keyboard, and stale-response isolation.
- **Live Zotero read-only path**: `npm run test:integration` needs a local Zotero at `127.0.0.1:23119`; not run this round.

### Gates actually run (real results)

- `npm test`: 661 spec files / 7129 tests — 659 files passed, 2 files skipped (requiring live Zotero and the write probe, totaling 27 skipped tests), 0 failed; no test loads a model or uses the network.
- `npm run release:check`: exit 0 (format, strict harness, lint:test, lint:hooks, style:check, typecheck, coverage, build, verify:pack all pass; `verify:pack` checked the packed entries).
- `npm run build:client` and `npx vitest run tests/host/doc-examples.spec.ts`: pass.

### Issue-by-issue closure (A1–X4)

| ID  | Fix location                                                                                             | Behaviour test                                                                                                                                      | Result                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | read-only `lookup` seam in `local/fulltext-enhancer.ts`, private parse domain in `enrichment/service.ts` | `tests/local/enrichment-enhancer.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`, `tests/host/enrichment-parse-jobs-admission.spec.ts` | Ordinary reads no longer call `enhance`/upload; negative assertions pass                                                                   |
| A2  | `enrichment/parse-{target,document,jobs}.ts`, client dialog                                              | `tests/host/enrichment-parse-*.spec.ts`, `tests/client/enrichment/parse-integration-*.spec.tsx`                                                     | Child/top-level attachment + URL entries, cancellation, idempotency, cross-session isolation pass                                          |
| A3  | `scholarly/fulltext/{resolve,store}.ts`, `enrichment/artifact-store.ts`                                  | `tests/scholarly/fulltext-cache.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`                                                        | New artifact wins; stale cache invalidated by revision                                                                                     |
| A4  | `src/scholarly/tools/read.ts`, `artifact-schema.ts`                                                      | `tests/scholarly/read/read-artifact-format.spec.ts`                                                                                                 | `format:'markdown'\|'text'`, outline/section, offset provenance pass                                                                       |
| S1  | `enrichment/semantic/admission.ts`, `model-profiles.ts`, `ranker.ts` (`routeBest-0.02` removed)          | `tests/unit/semantic-admission.spec.ts`, `tests/unit/semantic-ranker.spec.ts`                                                                       | Fixed cosine policies validated against archived real vectors; the report records both the old hybrid false hits and the corrected result. |
| S2  | per-phrasing independent admission + union in `local/evidence-ranker.ts`                                 | `tests/unit/semantic-ranker.spec.ts`, `tests/local/retrieve/evidence-ranker.spec.ts`                                                                | A new variant never removes an existing member                                                                                             |
| S3  | caller `indexes` in `src/evidence.ts`, dedup maps back to every source in `ranker.ts`                    | `tests/local/retrieve/evidence-ranker.spec.ts`, `tests/unit/semantic-ranker.spec.ts`                                                                | Sparse/reordered handles, duplicate text, duplicate handle rejection pass                                                                  |
| S4  | transactional resident/pending/retired loader                                                            | `tests/unit/semantic-loader-lifecycle.spec.ts`                                                                                                      | Failed B keeps A, A→B→A, draining, once-only release pass                                                                                  |
| S5  | `enrichment/semantic/vector-cache.ts`, `session.ts`                                                      | `tests/unit/semantic-vector-cache.spec.ts`, `tests/unit/semantic-session.spec.ts`                                                                   | Bounded cross-request cache, single `TokenizedBatch`, signal plumbing pass                                                                 |
| S6  | rendering in `src/tools/retrieve.ts`, `local/retrieve.ts`                                                | `tests/tools/retrieve-render.spec.ts`                                                                                                               | Explicit `noMatch` classification, budget omission never contradicts "no match"                                                            |
| D1  | response-consumption scope in `enrichment/model-download-client.ts`                                      | `tests/host/enrichment/model-response-scope.spec.ts`                                                                                                | 16 MiB real undici body, redirect/error body release pass                                                                                  |
| D2  | synchronous reservation + cancel/dispose draining in `model-downloader.ts`                               | `tests/host/enrichment/model-task-ownership.spec.ts`                                                                                                | Concurrency, cancellation, unmount, already-aborted caller pass                                                                            |
| D3  | `model-bundle-inspector.ts`, read-only status/verify                                                     | `tests/host/enrichment/model-installation-state.spec.ts`                                                                                            | Missing marker / same-size corruption / different revision = not-ready; zero status writes                                                 |
| D4  | `model-installation.ts`, `model-download-client.ts`                                                      | `tests/host/enrichment/model-installation-safety.spec.ts`, `model-cli-coordination.spec.ts`                                                         | Private staging, catalog whitelist, symlink sentinels, force preserves user files                                                          |
| D5  | `enrichment/safe-directory-path.ts`                                                                      | `tests/unit/enrichment-safe-directory-preflight.spec.ts`, `tests/unit/safe-directory.spec.ts`                                                       | Full candidate checked before creation; ENOENT vs I/O distinguished                                                                        |
| C1  | `client/index.ts`, `enrichment-form-controller.ts`                                                       | `tests/client/enrichment/model-error-codes.spec.ts`, `enrichment-model-controller.spec.ts`                                                          | Full `RemoteResult` code/details preserved; only `gateway/service-unavailable` means absent                                                |
| C2  | `{model,normalizedDir,generation}` binding                                                               | `tests/client/enrichment/model-generation-invalidation.spec.ts`                                                                                     | Late replies, drafts, external updates invalidate stale state                                                                              |
| C3  | `client/locales.ts`, `docs/configuration.*`, `docs/features.*`                                           | client specs + zh/en lockstep review                                                                                                                | "off → BM25; on but model unready → explicit failure" consistent in both languages                                                         |
| X1  | `enrichment/semantic/{session,tensor}.ts`                                                                | `tests/unit/semantic-session.spec.ts`, `semantic-tensor.spec.ts`                                                                                    | Ownership-transfer release, tensor rank/width/finite checks, cosine no longer truncates                                                    |
| X2  | `scripts/fetch-semantic-model.mjs`                                                                       | `tests/host/enrichment/model-cli-installer.spec.ts`, `model-cli-coordination.spec.ts`                                                               | Real cross-process lock, cancellation, private staging, `finally` dispatcher close                                                         |
| X3  | `semantic/model-profiles.ts`, `scripts/semantic-calibration/*`, `tests/fixtures/semantic-admission/*`    | Actual-vector admission report and six raw vector files; `semantic-admission-measurement.spec.ts` recomputes all observations.                      | No model/network in automated tests; historical logistic diagnostics have a separate metadata guard.                                       |
| X4  | repo-wide removal of `allowParsingUpload` / `dsh-zotero/parsing` / old two-slot wording                  | `tests/host/enrichment-parse-aliases.spec.ts`, doc grep                                                                                             | No legacy aliases, migrations, or compat branches                                                                                          |

"Pass" above means the corresponding behaviour tests and local gates pass; effect, live, and browser acceptance status is in the previous section.

## Testing Standards

- Unit tests run against a mock Zotero HTTP service (`MockZotero`);
- Browser configuration page tests use JSDOM and `@testing-library/react`;
- Coverage thresholds live in `vitest.config.ts`, with a gate metric for each core layer;
- Integration tests validate wire protocols and real data against a running Zotero instance.

### Client test doubles

Tool tests use public `@deepseek-ai/dsh-tool-testkit` fixtures to execute the real single-call pipeline. Locale fixtures use the pinned `@deepseek-ai/dsh-client-test-runtime/src/translate.ts`: the package explicitly exports `./src/*` and actually publishes `src`. This pure entry removes the local translation algorithm. Both test-support packages are devDependencies with exact harness overrides.

The full Slot runtime now assembles through explicitly published production-source contracts and is used for slot creation/disposal and resource composition. Only loader-only `/client` entries use this mapping; ordinary ESM entries retain their compiled path, and a separate test executes the physical resource bundle. Vitest dependencies resolve to one runner instance. The entry-composition test also runs the production `bootClient` through the public `TestClient`, renders the seven settings tabs, and verifies saves, reload, and full unmount; local recording doubles serve explicit fault injection only and do not stand in for assembly acceptance. Recheck source-mapping counterexamples, slot lifecycle and compiled-bundle execution when the runtime, browser exports or runner changes.

## CI Workflows

Four workflows live under `.github/workflows/`:

- `release-branch.yml`: creates one artifact in a read-only quality job when a `v*` tag is pushed, then installs it with pnpm 11 in fresh Linux, macOS and Windows profiles and imports all four host entries. Linux also runs browser Web smoke; failures retain the profile and installation logs. Once all three platforms pass, `npm-release` submits the tarball to npm through OIDC, and `publish` verifies the artifact and updates the prebuilt `release` branch;
- `verify-npm-release.yml`: starts after a successful release run and uses the `npm-publication` environment to delay execution. It reuses the original run artifact, verifies the public tarball, and creates the GitHub Release;
- `upstream-health.yml`: runs `npm run release:check` every Monday at 02:00 UTC and compares the pinned version against the upstream harness mainline;
- `scanner.yml`: runs the HOL Guard scanner on pull requests and pushes to `main`, failing when the normalized score drops below 75.

Supply-chain rules:

- Every third-party GitHub Action is pinned to an immutable commit SHA, with the matching version kept in a trailing comment, so a mutable tag cannot silently change the executed code;
- npm publication uses OIDC trusted publishing: `id-token: write` mints short-lived credentials (npm CLI ≥ 11.5.1 and Node ≥ 22.14; this repo's pinned Node 24.15.0 ships npm 11.12.1), and public repositories publishing public packages include provenance by default. Publication still relies on the trusted-publisher configuration on npmjs.com;
- `npm run deps:check` queries the registry directly and compares against `package-lock.json` to list eligible direct dependency updates. Node types follow the minimum major in `engines.node`, and Undici follows the pinned Harness proxy. Constrained releases are reported separately. Exit code 1 signals eligible updates and 2 signals a failed check. Upgrades stay manual, and Dependabot opens no version-update pull requests;
- Dependabot alerts serve as CVE reminders only, with security updates disabled;
- The browser bundle mirrors the third-party runtime dependencies the sibling harness declares in its own `packages/client/*` manifests (lexical, katex, react, zod, …); those versions move with the harness, and the `deps:check` exclusion set keeps them out of the report;
- The scanner workflow is granted only `contents: read` and keeps no checkout credentials, so a pull request from a fork runs it under the same constraints.

## Release Checklist

Run the following checks in order before a release, and stop at the first failure:

1. `npm run typecheck`: type checks for the Node, host-test, browser, browser-test, and CLI projects;
2. `npm run build:client`: the browser artifact builds on its own;
3. `npm test`: test specification guards (lanes, `.only`/`.skip`, spec line ratchet) plus the full vitest run;
4. `npm run format:check`: Prettier formatting check;
5. `npm run release:check`: the release gate, running `format:check`, `harness-state.mjs --strict`, `lint:test`, `lint:hooks`, `tokens:check`, `style:check`, `build`, `typecheck:program`, `test:coverage`, `test:calibration`, and `verify:pack` in order. Start from `npm ci --ignore-scripts` without a preliminary build;
6. Pack review: step 5's `verify:pack` already validated the tarball's required files; to confirm by hand, run `npm pack --dry-run` and check that the artifact contains `lib/`, `cordis.patch.yml`, `locale/`, `README`, and `docs/plugin-detail.md`;
7. Walk through acceptance workflows: G1 through G8 are mandatory; add P cases when the change touches the panel or the trail, and add W cases in a separate session with writes enabled when the change touches writing;
8. Asset check: this version's docs embed no screenshots, and `docs/images/` retains the plugin icon `icon.png`, header collage, and Web UI reference screenshots; if release notes add images, take them from the current Web UI and keep the wording consistent with the interface.

`npm test` and the release gate are not the same thing: `npm test` runs `node scripts/test-lint.mjs` plus `vitest run` without the coverage gate, which is the day-to-day regression command; the release path hands those two jobs to steps 3 and 5.

### Versions, release notes and publication

The three-platform smoke matrix copies the manifest and lockfile from `tests/fixtures/dsh-cli-consumer/` to the runner's temporary directory and uses `npm ci` to install the pinned dsh CLI and pnpm there. Only the Linux browser check installs repository development dependencies. The npm cache key includes both lockfiles. The CLI install step prints npm phase timings and the job retains the timing files on failure.

`package.json` owns the version. Before a release, update the root manifest in `package-lock.json` and prepare that version's changes, validation and migration requirements. Use `v<version>` for the tag on the main commit that passed every gate; the tag, manifest and release notes must agree. Prereleases use SemVer notation such as `1.3.0-alpha.1`. npm publication explicitly uses the first prerelease identifier as the dist-tag (`alpha` here; numeric or `latest` identifiers use `next`), and the GitHub Release is marked as a prerelease and excluded from Latest. Stable versions publish to `latest`.

CI's quality gate creates `release-artifact-<source SHA>`. All three installation platforms consume its exact tarball through the published, exactly pinned dsh CLI installed from the consumer lockfile, retain the host's default pnpm build-approval policy, and import all four host entries from the installed profile. Linux also verifies browser composition, settings saves and reloads. The publish job downloads that artifact, verifies its source and every file, then advances the project's release branch under a CAS lease. The job only downloads, verifies and publishes the artifact. A tag whose source predates the published source is refused.

npm publication and the GitHub Release are automated: pushing a `v<version>` tag triggers the `npm-release` job, which downloads the same verified artifact, re-checks its source and every file, and confirms that the tag, manifest and in-artifact version agree. Before publishing, the job queries `registry.npmjs.org`. An existing version must match the artifact's name, version and SHA-512 integrity. A 404 on the initial lookup permits OIDC submission of the original tarball named in `artifact.json`. Eligible public packages receive provenance automatically.

`verify-npm-release` downloads the public tarball and checks its bytes. After verification, it creates or updates the GitHub Release with the tag annotation, generated changelog, source SHA, artifactDigest and tarballSha256. A 404 for the public version adds a note to the run summary and ends the job; once npm shows **Published**, re-run the verification workflow. The original release artifact is retained for seven days, and failed downloads or verification can be retried by running the workflow again. Changed bytes require a new version and fresh verification.

Before enabling delayed verification, set a **15-minute** wait timer for the `npm-publication` environment in the repository Settings → Environments, and merge the verification workflow into the default branch. GitHub starts the runner after the wait. The verification job has a three-minute timeout.

Trusted publishing requires configuring a trusted publisher for `Vncntvx/dsh-zotero` on npmjs.com with the workflow filename set exactly to `release-branch.yml` (case-sensitive, including the extension) and `npm publish` allowed. The configuration binds the workflow filename, so renaming it breaks publication. The one-time setup and troubleshooting are in this section.

Use `npm run release:branch -- --dry-run --source-sha <HEAD SHA>` to inspect a local artifact from a clean worktree. A real push requires explicit `--push --artifact <checked artifact directory>` and targets only the project's origin release branch.

For release and harness upgrades, run `npm run smoke:web-composition` after the complete `release:check` gate. Retain its temporary profile, browser report and error logs. The validation scope is the exact tested pin.
