<p align="right"><a href="development.md"><b>中文</b></a></p>

# Development Guide

## Repository Structure

```text
src/
  index.ts              # Plugin entry (pure re-export)
  service.ts            # ZoteroService (Cordis service: tool wiring, commands, projections, and provider lifecycle)
  service-config.ts     # Transport-rebuild config keys and the LocalApiLimits mapping (split from service.ts)
  service-lifecycle.ts  # Config commit validation and volatile-update handling (split from service.ts)
  shell-write-approval.ts # Approval seam for shell commands that write to the local API directly (split from service.ts)
  tool-diagnostics.ts   # Tool execution diagnostics recording (split from service.ts)
  tool-registration.ts  # Read/write tool registration lists (split from service.ts)
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
  projection-keys.ts    # The zoteroStatus projection key and its type merge (shared by both halves)
  session-events.ts     # The zotero/status session event and the state-to-wire view fold
  status-projection.ts     # The zoteroStatus session projection unit (last-value fold)
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
  command.ts            # /zotero status command
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
| [Tool reference](tools.en.md)                  | 23 local tools (8 read + 15 write) and 7 scholarly retrieval tools                                                        |
| [Configuration reference](configuration.en.md) | Three settings namespaces, 44 fields, and the hot-reload mechanism                                                        |
| [Troubleshooting](troubleshooting.en.md)       | Common issues, causes, and diagnostic steps                                                                               |
| [Architecture](architecture.en.md)             | Data flow, layer responsibilities, and design boundaries                                                                  |
| [Development guide](development.en.md)         | Build, test, debug, and release flows                                                                                     |
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
npm run verify:pack          # Validate the packed tarball contents
npm run smoke                # Production-stack smoke: call every read tool against a real Zotero inside a dsh profile
npm run smoke:discovery      # Packed artifact → temporary profile → dsh web boot probe
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

## Integration Tests

```sh
npm run test:integration
```

Integration tests need a local Zotero running at `127.0.0.1:23119` with local API communication enabled.

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

> Note: the `dev-lib.cordis.yml` overlay loads the plugin through its built entry's absolute path (`<absolute-path-to-dsh-zotero>/lib/index.js`), which gives the host half (model tools and the `/zotero` command) restart-free hot reload under the Loader's watch. The Harness client module loader resolves only registered bare package names, so this mode does not load browser-side frontend components (settings page, literature trail, and literature panel). To debug the frontend UI, use the "Full Plugin Debugging" flow above (`dsh plugin --profile web add .` and `npm run dev:client`).

### Diagnostics Panel and Diagnostics Bundle

When investigating plugin runtime issues, turn on "Diagnostic mode" in the configuration area, then read runtime state and logs in the "Diagnostics" card at the bottom of the plugin detail page:

- Log collection and filtering: with diagnostics on, matching entries are collected and kept, with severity filtering available ("Problems" selects warn and error). Entries run newest first, and consecutive duplicate records collapse into one with a repeat count;
- Diagnostic mode: turn on "Diagnostic mode" in the "Advanced → Diagnostics" group of the dsh-zotero configuration area and save, and the detail page bottom shows the diagnostics panel and records detailed troubleshooting logs;
- Frontend crash capture: when a frontend surface (literature trail, literature panel, tool cards, and so on) hits a render crash, the error boundary records the error and names the failing location in the `surface` field (for example `sources` or `tool:zotero_search`);
- Exporting a diagnostics bundle: clicking "Copy diagnostics" produces a text bundle with the plugin version, the Zotero endpoint and version, the debug state, and every buffered record, ready to paste into an issue report.

## Testing Standards

- Unit tests run against a mock Zotero HTTP service (`MockZotero`);
- Browser configuration page tests use JSDOM and `@testing-library/react`;
- Coverage thresholds live in `vitest.config.ts`, with a gate metric for each core layer;
- Integration tests validate wire protocols and real data against a running Zotero instance.

## CI Workflows

Three workflows live under `.github/workflows/`:

- `release-branch.yml`: builds and pushes the prebuilt release branch on pushes to `main`, on version tags, and on manual dispatch, and is granted only `contents: write`;
- `upstream-health.yml`: runs `npm run release:check` every Monday at 02:00 UTC and compares the pinned version against the upstream harness mainline;
- `scanner.yml`: runs the HOL Guard scanner on pull requests and pushes to `main`, failing when the normalized score drops below 75.

Supply-chain rules:

- Every third-party GitHub Action is pinned to an immutable commit SHA, with the matching version kept in a trailing comment, so a mutable tag cannot silently change the executed code;
- `.github/dependabot.yml` tracks npm and GitHub Actions upstream, while `@deepseek-ai/*` versions are bumped together through `npm run harness:pin`, so Dependabot must not drift them;
- The browser bundle mirrors the third-party runtime dependencies the sibling harness declares in its own `packages/client/*` manifests (lexical, katex, react, zod, …); those versions move with the harness, and the Dependabot ignore list keeps them out of automated bumps;
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
8. Asset check: this version's docs cite no screenshots, and `docs/images/` keeps only the plugin icon `icon.png`; if release notes add images, take them from the current Web UI and keep the wording consistent with the interface.

`npm test` and the release gate are not the same thing: `npm test` runs `node scripts/test-lint.mjs` plus `vitest run` without the coverage gate, which is the day-to-day regression command; the release path hands those two jobs to steps 3 and 5.
