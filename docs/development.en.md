<p align="right"><a href="development.md"><b>中文</b></a></p>

# Development Guide

## Repository Structure

```text
src/
  index.ts              # Plugin entry (pure re-export)
  service.ts            # ZoteroService (Cordis service)
  local/provider.ts     # LocalApiProvider (Zotero Local API adapter)
  local/*-domain.ts     # Domain pipelines (search, export, changes, browse, write, etc.)
  local/                # Helper modules: detail, retrieve, attachment-location, scope-directory, etc.
  http-client.ts        # HTTP transport layer (loopback fetch, streaming, and concurrency slot control)
  config.ts             # Configuration schema and validation logic
  types.ts              # Domain DTOs and type definitions
  contract.ts           # Remote wire protocol surface and constants
  status-codec.ts       # Host-side status decoding (zod)
  abort.ts              # The one spelling of the caller-cancellation error (harness TOOL_ABORTED)
  errors.ts             # Error classes and error codes
  json.ts               # Lossless JSON read helpers
  evidence-item.ts      # Passage item projection definitions (shared across client/host)
  browse-rows.ts        # Browse row classification (shared across client/host)
  changes-contract.ts   # Shared wire descriptors for the changes projection
  projection-keys.ts    # The zoteroStatus projection key and its type merge (shared across client/host)
  session-events.ts     # The zotero/status session event and the status-to-wire view fold
  status-projection.ts  # The zoteroStatus session projection unit (last-value fold)
  constants.ts          # Constant definitions
  concurrency.ts        # Bounded concurrency controller
  job-runner.ts         # ctx.jobs background-job adapter for the heavy tools
  evidence.ts           # BM25 ranking algorithm
  search-text.ts        # Search folding matching Zotero normalizeForSearch
  attachments.ts        # Attachment selection and priority logic
  normalize.ts          # Zotero response to domain DTO normalization
  presentation-meta.ts  # Presentation projection for tool results
  refs.ts               # Zotero ref syntax parsing and formatting
  ref-grammar.ts        # Reference syntax validation patterns
  export-items.ts       # BibTeX key grammar and field extraction
  export-mapping.ts     # Reference and batch item mapping
  prompt.ts             # Model-facing system prompt section
  command.ts            # /zotero status command
  write-approval.ts     # Two-tier write confirmation (approval policy and plan review card)
  write-auth.ts         # Zotero local write key acquisition and persistence
  write-http.ts         # Local write HTTP request handling
  write-item-rules.ts   # Write field and update rules (shared by tools and write domain)
  shell-write-detector.ts # Shell command interception for direct Local API writes
  remote.ts             # Web client Remote service
  typert.ts             # Typert manifest
  settings-namespace.ts # Settings namespace constants
  tools/                # 23 local model tool definitions (8 read + 15 write)
  tools/degradable.ts   # The degrade rule for write-tool plan previews (only unreachable or ambiguous targets)
  client/               # Browser client (configuration page, Sources panel, tool card views)
tests/                  # Unit and end-to-end test suites
```

## Installation and Build

```sh
npm install                  # Install dependencies (alongside deepseek-harness)
npm test                     # Run unit tests and test specification checks
npm run typecheck            # Run type checking (Node, test, and client projects)
npm run build                # Compile all artifacts (tsc → lib/, esbuild → lib/client.js)
npm run build:client         # Build browser client artifact only
npm run test:coverage        # Check coverage gates
npm run harness:check        # Check upstream Harness version pin and artifact freshness
npm run harness:pin -- <ver> # Update upstream Harness dependency pin across all surfaces
npm run verify:pack          # Validate package tarball integrity
npm run smoke                # Production-stack smoke: every read tool against a live Zotero from a dsh profile
npm run smoke:discovery      # Packed tarball → throwaway profile → dsh web boot probe
npm run release:branch       # Cut the publishable release branch (manifest-driven)
npm run lint:test            # Run the test-lint guards only
npm run test:watch           # vitest watch mode
npm run format               # Format code with Prettier
npm run format:check         # Check code formatting
```

`prepare` (triggered by `npm install`) builds `lib/` from source; `prepublishOnly` runs `release:check` before a publish can go out.

Note: This repository is typically developed as a sibling directory to `deepseek-harness`. Type declarations are resolved from upstream build artifacts via symlinks. If upstream code changes, run the upstream build first to synchronize declaration files.

Published `@deepseek-ai/dsh-client-*` packages declare their third-party runtime dependencies in their own `devDependencies` (the shell supplies them when bundling) and reference `.module.css` files directly from `lib/`. This repository therefore mirrors those third-party dependencies in `devDependencies` and lists `@deepseek-ai/dsh-client-*` as inlined in `vitest.config.ts`, so the client test lane also loads them in an environment with only a registry install and no sibling checkout (CI).

### Upstream artifact freshness check

`npm run harness:check` checks whether upstream build artifacts are up to date. The two checks are independent.

1. Declarations versus source: verifies that `lib/types/*.d.ts` is newer than the corresponding upstream source files, so type checking never reads an interface compiled from older source. Remedy: rebuild both the declarations and the Node-side artifacts.
2. Browser runtime versus declarations: verifies that a client package's `lib/client.js` is newer than its own client declarations, so the runtime the page loads is not older than the declarations the compiler read. Remedy: rebuild the browser artifacts only.

```sh
pnpm --dir ../deepseek-harness run build            # check 1: declarations and Node-side artifacts
pnpm --dir ../deepseek-harness run build:lib:client # check 2: browser artifacts only
```

Without `--strict`, both checks print a note. With `--strict` (the mode `release:check` uses), both become errors that fail the run. Missing declarations fail in both modes because type checking cannot resolve them at all.

The same script also gates the vendored framework packages: the floor of every `cordis`, `cosmokit`, `schemastery`, and `cordis-plugin-*` range in `dependencies` / `devDependencies` / `peerDependencies` must equal the version in the sibling's `vendor/<pkg>/package.json`, and a mismatch fails in both modes. These packages do not follow the harness pin, and a `^X.Y.Z-alpha.N` floor leaves two copies of `cordis` in one profile.

## Integration Tests

```sh
npm run test:integration
```

Integration tests require a local Zotero instance running at `127.0.0.1:23119` with the Local API enabled.

## Build Artifacts

- Node artifact (`lib/`): Compiled by `tsc`, containing service logic, tool definitions, provider, and transport layers.
- Browser artifact (`lib/client.js`): Bundled by `esbuild`, containing the configuration page, Sources panel, and session cards.

## Local Debugging

### Full Plugin Debugging (with Web UI)

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml "$DSH_HOME/"   # seeds write credentials only; see the note below
chmod 600 "$DSH_HOME/.credentials.yaml"
npm run build
dsh plugin --profile web add .
npm run dev &        # Watch Node-side changes
npm run dev:client & # Watch browser-side changes
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

> Note: since alpha.4 the plugin's configuration persists in the active profile's `cordis.patch.yml` (the `zotero` entry), and `~/.dsh/settings.yaml` is imported once at startup only. Fill the Zotero connection settings once in the temp instance's plugin manager under the **dsh-zotero** configuration section (or copy the `zotero` entry's `config` from one of your existing profiles' `cordis.patch.yml`).

### Host-Only Debugging (with HMR)

```sh
npm run build                                    # Initial build of lib/
npm run dev &                                    # Watch and incrementally compile to lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml # Copy template and fill absolute checkout paths
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

> Note: the `dev-lib.cordis.yml` overlay points to the built entry using an absolute path (`<absolute-path-to-dsh-zotero>/lib/index.js`), enabling in-process Loader HMR for the host half (tools and `/zotero` command) without restarting dsh. However, the harness web client module loader only resolves plugins registered under bare package names. Consequently, this mode does not load browser-side frontend modules (configuration page or Sources tab). To develop and test the UI, use the "Full Plugin Debugging" workflow above (`dsh plugin --profile web add .` and `npm run dev:client`).

### Diagnostics Panel and Diagnostics Bundle

To inspect runtime behavior or investigate issues, enable "Diagnostic mode" in configuration; the "Diagnostics" card at the bottom of the **dsh-zotero** detail page shows runtime state and logs:

- **Record retention and filtering**: When diagnostic mode is enabled, relevant events are collected with severity filtering available ("Problems" selects warn and error). Entries are listed in reverse chronological order, and consecutive identical messages are coalesced with a repeat counter;
- **Diagnostic mode**: Enable "Diagnostic mode" in the "Diagnostics" group of the dsh-zotero configuration section and save to display the diagnostics card at the bottom and collect detailed troubleshooting records;
- **Client crash reporting**: When browser-side components (such as the Sources tab, tool cards, or detail panels) encounter a render crash, error boundaries automatically log the event and identify the failing surface in the `surface` field (for example, `sources` or `tool:zotero_search`);
- **Exporting records**: Clicking "Copy diagnostics" exports a text bundle containing the plugin version, Zotero endpoint and version, debug state, and all buffered log entries for bug reports.

## Testing Standards

- Unit tests run against a mock Zotero HTTP service (`MockZotero`).
- Browser configuration page tests use JSDOM and `@testing-library/react`.
- Coverage thresholds are defined in `vitest.config.ts`, with separate gates enforced for each core layer.
- Integration tests validate wire protocols and real data against an active Zotero instance.

## Release Checklist

`release:check` in `package.json` defines the release gate. It runs the first seven steps in order and stops at the first failure:

1. `npm run format:check`: Prettier formatting check.
2. `npm run harness:check -- --strict`: version pin, upstream declarations, and vendored framework versions must align; stale artifacts become errors in this mode (`release:check` invokes the same script directly as `node scripts/harness-state.mjs --strict`).
3. `npm run lint:test`: test-specification guards (lanes, `.only`/`.skip`, spec line ratchet).
4. `npm run typecheck`: type checking across the Node, test, and client projects.
5. `npm run test:coverage`: the full vitest suite plus the per-layer coverage gates.
6. `npm run build`: production build (`tsc` → `lib/`, esbuild → `lib/client.js`).
7. `npm run verify:pack`: validate the required files in the packed tarball.
8. Verify golden path scenarios (G1 through G8) in [Scenarios](scenarios.en.md); verify W1 through W8 as well if write operations are enabled.

`npm test` is not the release gate: it runs `node scripts/test-lint.mjs` plus `vitest run` without coverage thresholds, which is the day-to-day regression command. The release path splits those two concerns into steps 3 and 5.
