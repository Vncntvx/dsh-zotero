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
  status-codec.ts       # Host-side status decoding (zod)
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
  shell-write-detector.ts # Interception detection for shell commands that write to the local API directly
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
| [Configuration reference](configuration.en.md) | Four settings namespaces, 65 fields, and the hot-reload mechanism                                                         |
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
npm run typecheck            # Type check (Node, test, and browser projects)
npm run build                # Compile all artifacts (tsc → lib/, esbuild → lib/client.js)
npm run build:client         # Build the browser artifact only
npm run test:coverage        # Coverage gate check
npm run harness:check        # Check the upstream Harness version pin and artifact consistency
npm run harness:pin -- <ver> # Update every Harness dependency pin together
npm run deps:check           # Query the registry for direct dependencies behind their latest release
npm run verify:pack          # Validate the packed tarball contents
npm run smoke                # Production-stack smoke: call every read tool against a real Zotero inside a dsh profile
npm run smoke:discovery      # Packed artifact → temporary profile (build approval recorded first) → dsh web boot probe
npm run release:branch       # Cut the publishable release branch (manifest-driven)
npm run release:check        # Release gate: format, version pin, tests, types, coverage, build, pack
npm run link:local-harness   # Link the @deepseek-ai/dsh-* dependencies to the sibling checkout
npm run dev                  # Watch Node-side sources and compile incrementally
npm run dev:client           # Watch browser-side sources and bundle incrementally
npm run lint:test            # Run the test specification guards only
npm run test:watch           # vitest watch mode
npm run format               # Run Prettier formatting
npm run format:check         # Check code formatting
```

`prepare` (triggered by `npm install`) builds `lib/` from source; `prepublishOnly` runs `release:check` before a publish can go out.

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

After `npm run harness:pin -- <ver>`, the artifact-freshness gate above is not enough: the upstream semantics this repository mirrors on purpose do not follow the pin by themselves.

```sh
# Tool-block predicate: isSettledTool in src/sources/presenters.ts mirrors it
rg -n "export declare function isSettledTool" -A 4 ../deepseek-harness/packages/client/ui-chat/src/client/contract/chat-nodes.ts
# Result text: resultTextOf in the same file mirrors it (upstream does not export it from ./client)
rg -n "function resultText" -A 30 ../deepseek-harness/packages/client/ui-tool/src/client/tool/models/tool-call-model.ts
```

`isSettledTool` is publicly exported from `@deepseek-ai/dsh-client-ui-chat/client`; `resultText` has no public entry. Both mirrors are reused by the host half, so neither can become a value import. If an upstream implementation changes (especially the empty-content-with-error fallback and the `preparing` decision), update the degradation matrix in `tests/client/presenters.spec.ts` with it.

## Integration Tests

```sh
npm run test:integration
```

Integration tests need a local Zotero running at `127.0.0.1:23119` with local API communication enabled.

## Semantic admission tiers (fixed in code)

Local semantic ranking no longer depends on offline calibration data: each tier's `floor` (absolute cosine gate) and `margin` (tolerance below the best cosine) are fixed in `src/enrichment/semantic/model-profiles.ts`, so an installed bundle works immediately and an unknown tier fails closed with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`.

The `floor` comes from measurement on real model output: 12 bilingual topic families, each with one answering passage, four same-family distractors, a paraphrase question that shares **no content word** with the answer, and an unrelated question nothing answers. Because the question and answer share nothing, BM25 scores the answer zero, so every admitted passage can only come from the semantic route. The floor sits between the weakest true paraphrase and the strongest unrelated-corpus cosine and is biased to safety: missing a hit is better than presenting an unrelated passage as evidence.

Measured across the six tiers (in-scope languages):

| Tier        | floor | margin | semantic recall@1 | semantic recall@4 |   MRR | unrelated semantic hits |
| ----------- | ----: | -----: | ----------------: | ----------------: | ----: | ----------------------: |
| balanced    | 0.427 |   0.12 |               79% |               92% | 0.854 |                      0% |
| lightweight | 0.797 |   0.02 |               58% |               58% | 0.583 |                      0% |
| bilingual   | 0.515 |   0.12 |               88% |               96% | 0.910 |                      0% |
| english     | 0.593 |   0.12 |               83% |               92% | 0.861 |                      0% |
| hybrid      | 0.461 |   0.12 |               67% |               92% | 0.785 |                      0% |
| academic    | 0.584 |   0.12 |               79% |               92% | 0.854 |                      0% |

BM25 recall@4 on the same questions is 0% (zero content-word overlap), so these numbers are the semantic route's net gain. `lightweight` (Granite-97M) has its unrelated-corpus maximum close to its weakest true paraphrase, so the safe floor keeps only 58% recall; that is the tier's real limit, not a number to trade a lower floor for.

Re-measuring after a model revision or tier change is a **manual, model-requiring procedure outside the repository's tests**: a `floor` can only be derived from real embeddings. The repository's own tests never load a model and never use the network. Steps:

```sh
# 1. Download and verify the model (skip if already installed locally)
npm run assets:semantic -- --model=<key> --dir=<model root>
# 2. Export that tier's encoding input (pure CPU, no model)
node scripts/semantic-calibration/prepare.mjs --mode encoding --split fit > /tmp/encoding.json
# 3. Encode the entries in /tmp/encoding.json with that tier's real ONNX bundle and write the vector file
#    (the format is the requiredEmbeddingFormat printed by prepare)
# 4. Fit a candidate and read the calibration support and threshold (consumes supplied vectors, loads no model)
node scripts/semantic-calibration/fit.mjs --embeddings /absolute/fit-vectors.json
# 5. Write that tier's floor/margin back into model-profiles.ts and record where it came from
```

`scripts/semantic-calibration/` is the offline data and fitting toolchain: CPU and filesystem only, no model load or download, no network, output to stdout; `self-check.mjs` and `validate.mjs` validate the dataset itself without a model. The six tiers' `floor`/`margin` were measured this way and written into code.

## Build Artifacts

- Node artifact (`lib/`): compiled by `tsc`, containing service logic, tool definitions, the provider, and the transport layer;
- Browser artifact (`lib/client.js`): bundled by `esbuild`, containing the settings page, the literature trail, the literature panel, and session cards.

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

| WP   | Topic                                                          | Behaviour test evidence (specs that exist)                                                                                                                                                                                 | Acceptance result                                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0  | Freeze product, protocol, and reproduction standard            | `tests/host/enrichment-api-contract.spec.ts`, `tests/unit/enrichment-preferences.spec.ts`, `tests/unit/enrichment-parse-wire.spec.ts`, `tests/host/doc-examples.spec.ts`                                                   | Implemented (closed protocol, two-end types, component enablement authorizes document egress, domain codes preserved across the gateway, legacy parsing aliases removed); this table is the number→test→acceptance record                                                                         |
| WP1  | Ordinary reads only reuse parsed artifacts                     | `tests/local/enrichment-enhancer.spec.ts`, `tests/local/retrieve/retrieve-sources.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`                                                                             | Implemented (read-only `lookup` seam, hit priority / normal miss, negative assertions that startup, PDF opening, and settings saves trigger no MinerU)                                                                                                                                            |
| WP2  | Two explicit parsing entry points and job lifecycle            | `tests/host/enrichment-parse-document.spec.ts`, `tests/host/enrichment-parse-jobs-lifetime.spec.ts`, `tests/host/enrichment-parse-jobs-admission.spec.ts`, `tests/client/enrichment/parse-integration-operations.spec.tsx` | Implemented (closed-union target, session-owned `ctx.jobs`, cancellation/unmount cleanup, Gateway error classification)                                                                                                                                                                           |
| WP3  | Source identity, parse priority, and Markdown structure        | `tests/host/enrichment-artifact-format.spec.ts`, `tests/scholarly/read/read-artifact-format.spec.ts`, `tests/host/enrichment-source-publication.spec.ts`                                                                   | Implemented (unified identity / source stamp, Markdown `format`, outline/section, cache invalidation, old plain text no longer shadowing a new artifact)                                                                                                                                          |
| WP4  | Download, installation, directory, and CLI                     | `tests/host/enrichment/model-cli-coordination.spec.ts`, `tests/host/enrichment/model-installation-safety.spec.ts`, `tests/unit/model-download-client.spec.ts`, `tests/unit/enrichment-safe-directory-preflight.spec.ts`    | Implemented (real stream / lock / symlink and cancellation safety, single bundle verification rule, CLI parity)                                                                                                                                                                                   |
| WP5  | Ranking identity, variants baseline, and output interpretation | `tests/local/retrieve/evidence-ranker.spec.ts`, `tests/tools/retrieve-render.spec.ts`, `tests/unit/evidence.spec.ts`                                                                                                       | Implemented (caller index preservation, duplicate handle rejection, semantic dedup maps back to every source, monotone variant union, empty-result claims only on explicit `noMatch`)                                                                                                             |
| WP6  | Reject unrelated corpora in semantic admission                 | `tests/unit/semantic-admission.spec.ts`, `tests/unit/semantic-ranker.spec.ts`, `scripts/semantic-calibration/self-check.mjs`                                                                                               | Implemented and measured: admission fixed per tier as `floor`+`margin`; on a zero-overlap paraphrase set the six tiers reach recall@4 58–96% with 0% unrelated semantic hits (see "Semantic admission tiers"). Model measurement is a manual procedure; the repository's tests never load a model |
| WP7  | Read scopes, transactional model switch, and draining          | `tests/unit/semantic-loader-lifecycle.spec.ts`, `tests/local/retrieve/retrieve-sources.spec.ts`, `tests/scholarly/fulltext.spec.ts`                                                                                        | Implemented (foreground scope admitted before source I/O and released in `finally`, transactional resident/pending/retired loader, a failed B keeps A, teardown drains)                                                                                                                           |
| WP8  | Inference cancellation, validation, and bounded vector cache   | `tests/unit/semantic-session.spec.ts`, `tests/unit/semantic-tensor.spec.ts`, `tests/unit/semantic-vector-cache.spec.ts`                                                                                                    | Implemented (single `TokenizedBatch`, signal throughout, output tensor validation, ownership-transfer release, bounded `lru-cache@11.5.3` cross-request cache); measured green on all six real tiers (see "Semantic admission tiers")                                                             |
| WP9  | End-to-end model settings state machine                        | `tests/client/enrichment/enrichment-model-controller.spec.ts`, `tests/client/enrichment/enrichment-model-form.spec.tsx`                                                                                                    | Implemented (full `RemoteResult` code/details preserved, only `gateway/service-unavailable` means absent, target generations, invalid draft sends no RPC, serial refresh and signal cleanup, zh/en wording in lockstep)                                                                           |
| WP10 | Clean up docs, legacy semantics, and package contract          | `tests/host/doc-examples.spec.ts`, `tests/unit/tooling/client-graph-authority.spec.ts`                                                                                                                                     | Implemented (12 zh/en doc pairs, legacy semantics removed, error-code tables, semantic admission tiers and this table); source/prebuilt double-install check not run                                                                                                                              |
| WP11 | Layered and real acceptance, issue-by-issue closure            | `npm run test:integration`, `npm run smoke:web-composition`                                                                                                                                                                | Not accepted (overall acceptance gate; does not replace the live checks below)                                                                                                                                                                                                                    |

### Live acceptance not run (needs separate user authorization)

The following were not run this round and are marked "Not accepted". Before running them, obtain the user's authorization for the specific documents under test; enabling the component authorizes a capability, not a live upload of any document, and simulated component tests do not replace browser acceptance:

- **MinerU free / pro live uploads**: test each with a dedicated synthetic PDF of known content (attachments in an isolated library / test items); without pro credentials or a live service, mark it not accepted.
- **Browser end-to-end acceptance**: pack into a temporary Harness profile and actually operate attachment parsing, top-level attachments, URL parsing, reparse, cancel, reconnect, component switch, and model switch, verifying control permissions, progress, error recovery, narrow-screen/keyboard, and stale-response isolation.
- **Live Zotero read-only path**: `npm run test:integration` needs a local Zotero at `127.0.0.1:23119`; not run this round.

### Gates actually run (real results)

- `npm test`: 491 spec files / 5736 tests — 489 files passed, 2 files skipped (requiring live Zotero and the write probe, totaling 27 skipped tests), 0 failed; no test loads a model or uses the network.
- `npm run release:check`: exit 0 (format, strict harness, lint:test, style:check, typecheck, coverage, build, verify:pack all pass; `verify:pack` checked the packed entries).
- `npm run build:client` and `npx vitest run tests/host/doc-examples.spec.ts`: pass.

### Issue-by-issue closure (A1–X4)

| ID  | Fix location                                                                                                           | Behaviour test                                                                                                                                      | Result                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | read-only `lookup` seam in `local/fulltext-enhancer.ts`, private parse domain in `enrichment/service.ts`               | `tests/local/enrichment-enhancer.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`, `tests/host/enrichment-parse-jobs-admission.spec.ts` | Ordinary reads no longer call `enhance`/upload; negative assertions pass                                                                                                          |
| A2  | `enrichment/parse-{target,document,jobs}.ts`, client dialog                                                            | `tests/host/enrichment-parse-*.spec.ts`, `tests/client/enrichment/parse-integration-*.spec.tsx`                                                     | Child/top-level attachment + URL entries, cancellation, idempotency, cross-session isolation pass                                                                                 |
| A3  | `scholarly/fulltext/{resolve,store}.ts`, `enrichment/artifact-store.ts`                                                | `tests/scholarly/fulltext-cache.spec.ts`, `tests/scholarly/enrichment-read-enhancer.spec.ts`                                                        | New artifact wins; stale cache invalidated by revision                                                                                                                            |
| A4  | `src/scholarly/tools/read.ts`, `artifact-schema.ts`                                                                    | `tests/scholarly/read/read-artifact-format.spec.ts`                                                                                                 | `format:'markdown'\|'text'`, outline/section, offset provenance pass                                                                                                              |
| S1  | `enrichment/semantic/admission.ts`, `model-profiles.ts`, `ranker.ts` (`routeBest-0.02` removed)                        | `tests/unit/semantic-admission.spec.ts`, `tests/unit/semantic-ranker.spec.ts`                                                                       | Baked floor+margin admits paraphrases and refuses a wholly unrelated corpus across all six tiers (0% unrelated semantic hits)                                                     |
| S2  | per-phrasing independent admission + union in `local/evidence-ranker.ts`                                               | `tests/unit/semantic-ranker.spec.ts`, `tests/local/retrieve/evidence-ranker.spec.ts`                                                                | A new variant never removes an existing member                                                                                                                                    |
| S3  | caller `indexes` in `src/evidence.ts`, dedup maps back to every source in `ranker.ts`                                  | `tests/local/retrieve/evidence-ranker.spec.ts`, `tests/unit/semantic-ranker.spec.ts`                                                                | Sparse/reordered handles, duplicate text, duplicate handle rejection pass                                                                                                         |
| S4  | transactional resident/pending/retired loader                                                                          | `tests/unit/semantic-loader-lifecycle.spec.ts`                                                                                                      | Failed B keeps A, A→B→A, draining, once-only release pass                                                                                                                         |
| S5  | `enrichment/semantic/vector-cache.ts`, `session.ts`                                                                    | `tests/unit/semantic-vector-cache.spec.ts`, `tests/unit/semantic-session.spec.ts`                                                                   | Bounded cross-request cache, single `TokenizedBatch`, signal plumbing pass                                                                                                        |
| S6  | rendering in `src/tools/retrieve.ts`, `local/retrieve.ts`                                                              | `tests/tools/retrieve-render.spec.ts`                                                                                                               | Explicit `noMatch` classification, budget omission never contradicts "no match"                                                                                                   |
| D1  | response-consumption scope in `enrichment/model-download-client.ts`                                                    | `tests/host/enrichment/model-response-scope.spec.ts`                                                                                                | 16 MiB real undici body, redirect/error body release pass                                                                                                                         |
| D2  | synchronous reservation + cancel/dispose draining in `model-downloader.ts`                                             | `tests/host/enrichment/model-task-ownership.spec.ts`                                                                                                | Concurrency, cancellation, unmount, already-aborted caller pass                                                                                                                   |
| D3  | `model-bundle-inspector.ts`, read-only status/verify                                                                   | `tests/host/enrichment/model-installation-state.spec.ts`                                                                                            | Missing marker / same-size corruption / different revision = not-ready; zero status writes                                                                                        |
| D4  | `model-installation.ts`, `model-download-client.ts`                                                                    | `tests/host/enrichment/model-installation-safety.spec.ts`, `model-cli-coordination.spec.ts`                                                         | Private staging, catalog whitelist, symlink sentinels, force preserves user files                                                                                                 |
| D5  | `enrichment/safe-directory-path.ts`                                                                                    | `tests/unit/enrichment-safe-directory-preflight.spec.ts`, `tests/unit/safe-directory.spec.ts`                                                       | Full candidate checked before creation; ENOENT vs I/O distinguished                                                                                                               |
| C1  | `client/index.ts`, `enrichment-form-controller.ts`                                                                     | `tests/client/enrichment/model-error-codes.spec.ts`, `enrichment-model-controller.spec.ts`                                                          | Full `RemoteResult` code/details preserved; only `gateway/service-unavailable` means absent                                                                                       |
| C2  | `{model,normalizedDir,generation}` binding                                                                             | `tests/client/enrichment/model-generation-invalidation.spec.ts`                                                                                     | Late replies, drafts, external updates invalidate stale state                                                                                                                     |
| C3  | `client/locales.ts`, `docs/configuration.*`, `docs/features.*`                                                         | client specs + zh/en lockstep review                                                                                                                | "off → BM25; on but model unready → explicit failure" consistent in both languages                                                                                                |
| X1  | `enrichment/semantic/{session,tensor}.ts`                                                                              | `tests/unit/semantic-session.spec.ts`, `semantic-tensor.spec.ts`                                                                                    | Ownership-transfer release, tensor rank/width/finite checks, cosine no longer truncates                                                                                           |
| X2  | `scripts/fetch-semantic-model.mjs`                                                                                     | `tests/host/enrichment/model-cli-installer.spec.ts`, `model-cli-coordination.spec.ts`                                                               | Real cross-process lock, cancellation, private staging, `finally` dispatcher close                                                                                                |
| X3  | `src/enrichment/semantic/model-profiles.ts`, `scripts/semantic-calibration/*`, `tests/fixtures/semantic-calibration/*` | Offline calibration chain, dataset, and the six-tier runtime report (guarded by `tests/unit/semantic-runtime-report.spec.ts`)                       | Every tier constant has a real measurement source and an archived report; the offline chain self-checks without a model; model re-measurement is documented as a manual procedure |
| X4  | repo-wide removal of `allowParsingUpload` / `dsh-zotero/parsing` / old two-slot wording                                | `tests/host/enrichment-parse-aliases.spec.ts`, doc grep                                                                                             | No legacy aliases, migrations, or compat branches                                                                                                                                 |

"Pass" above means the corresponding behaviour tests and local gates pass; effect, live, and browser acceptance status is in the previous section and must not be read as full live completion.

## Testing Standards

- Unit tests run against a mock Zotero HTTP service (`MockZotero`);
- Browser configuration page tests use JSDOM and `@testing-library/react`;
- Coverage thresholds live in `vitest.config.ts`, with a gate metric for each core layer;
- Integration tests validate wire protocols and real data against a running Zotero instance.

### Client test doubles

The locale and Remote/access doubles under `tests/client/helpers/` are local implementations, not imports from the upstream `@deepseek-ai/dsh-client-test-runtime`. That package **is** published at the current pin, but installing it grows the dev graph by 28 packages: its peer set requires six harness packages this plugin does not carry (`dsh-client-web`, `dsh-client-hmr`, `dsh-client-modules`, `dsh-remote-mock`, `dsh-api-workspace-controller`, `dsh-host-directory-picker`), and its hard `vitest ^4.1.11` dependency nests a second test runner beside this repo's v5. Its root entry also loads the whole jsdom slot runtime, so even one pure function costs every importing spec that load. To re-check: `npm install --dry-run @deepseek-ai/dsh-client-test-runtime@<pin>` and read the added packages. If an upstream implementation changes, sync the local double named in that module's comment.

## CI Workflows

Three workflows live under `.github/workflows/`:

- `release-branch.yml`: builds and pushes the prebuilt release branch on pushes to `main`, on version tags, and on manual dispatch, and is granted only `contents: write`;
- `upstream-health.yml`: runs `npm run release:check` every Monday at 02:00 UTC and compares the pinned version against the upstream harness mainline;
- `scanner.yml`: runs the HOL Guard scanner on pull requests and pushes to `main`, failing when the normalized score drops below 75.

Supply-chain rules:

- Every third-party GitHub Action is pinned to an immutable commit SHA, with the matching version kept in a trailing comment, so a mutable tag cannot silently change the executed code;
- `npm run deps:check` queries the registry directly and compares against `package-lock.json` to list direct dependencies behind their published release; upgrades stay manual, and Dependabot opens no version-update pull requests;
- Dependabot alerts are the CVE reminder only; security updates are off, so no pull request is generated;
- The browser bundle mirrors the third-party runtime dependencies the sibling harness declares in its own `packages/client/*` manifests (lexical, katex, react, zod, …); those versions move with the harness, and the `deps:check` exclusion set keeps them out of the report;
- The scanner workflow is granted only `contents: read` and keeps no checkout credentials, so a pull request from a fork runs it under the same constraints.

## Release Checklist

Run the following checks in order before a release, and stop at the first failure:

1. `npm run typecheck`: type checks for the Node, test, and browser projects;
2. `npm run build:client`: the browser artifact builds on its own;
3. `npm test`: test specification guards (lanes, `.only`/`.skip`, spec line ratchet) plus the full vitest run;
4. `npm run format:check`: Prettier formatting check;
5. `npm run release:check`: the release gate, running `format:check`, `harness-state.mjs --strict`, `lint:test`, `typecheck`, `test:coverage`, `build`, and `verify:pack` in order;
6. Pack review: step 5's `verify:pack` already validated the tarball's required files; to confirm by hand, run `npm pack --dry-run` and check that the artifact contains `lib/`, `cordis.patch.yml`, `locale/`, `README`, and `docs/plugin-detail.md`;
7. Walk through acceptance workflows: G1 through G8 are mandatory; add P cases when the change touches the panel or the trail, and add W cases in a separate session with writes enabled when the change touches writing;
8. Asset check: this version's docs embed no screenshots, and `docs/images/` retains the plugin icon `icon.png`, header collage, and Web UI reference screenshots; if release notes add images, take them from the current Web UI and keep the wording consistent with the interface.

`npm test` and the release gate are not the same thing: `npm test` runs `node scripts/test-lint.mjs` plus `vitest run` without the coverage gate, which is the day-to-day regression command; the release path hands those two jobs to steps 3 and 5.
