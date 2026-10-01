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
  errors.ts             # Error classes and error codes
  json.ts               # Lossless JSON read helpers
  evidence-item.ts      # Evidence item projection definitions (shared across client/host)
  constants.ts          # Constant definitions
  concurrency.ts        # Bounded concurrency controller
  evidence.ts           # BM25 ranking algorithm
  search-text.ts        # Search folding matching Zotero normalizeForSearch
  attachments.ts        # Attachment selection and priority logic
  normalize.ts          # Zotero response to domain DTO normalization
  presentation-meta.ts  # Presentation projection for tool results
  refs.ts               # Zotero ref syntax parsing and formatting
  ref-grammar.ts        # Reference syntax validation patterns
  export-items.ts       # Per-document export parsing
  export-mapping.ts     # Reference and batch item mapping
  ask.ts                # User interaction prompt and retry coordination on connection failure
  prompt.ts             # Model-facing system prompt section
  command.ts            # /zotero status command
  write-approval.ts     # Two-tier write confirmation (approval policy and plan review card)
  write-auth.ts         # Zotero local write key acquisition and persistence
  write-http.ts         # Local write HTTP request handling
  shell-write-detector.ts # Shell command interception for direct Local API writes
  remote.ts             # Web client Remote service
  typert.ts             # Typert manifest
  settings-namespace.ts # Settings namespace constants
  tools/                # 16 model tool definitions (8 read + 8 write)
  client/               # Browser client (settings page, Sources panel, tool card views)
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
npm run harness:check        # Check upstream Harness version pin and declaration freshness
npm run harness:pin -- <ver> # Update upstream Harness dependency pin across all surfaces
npm run verify:pack          # Validate package tarball integrity
npm run format               # Format code with Prettier
npm run format:check         # Check code formatting
```

Note: This repository is typically developed as a sibling directory to `deepseek-harness`. Type declarations are resolved from upstream build artifacts via symlinks. If upstream code changes, run the upstream build first to synchronize declaration files.

## Integration Tests

```sh
npm run test:integration
```

Integration tests require a local Zotero instance running at `127.0.0.1:23119` with the Local API enabled.

## Build Artifacts

- **Node artifact** (`lib/`): Compiled by `tsc`, containing service logic, tool definitions, provider, and transport layers.
- **Browser artifact** (`lib/client.js`): Bundled by `esbuild`, containing the settings page, Sources panel, and session cards.

## Local Debugging

### Full Plugin Debugging (with Web UI)

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml "$DSH_HOME/"
chmod 600 "$DSH_HOME/.credentials.yaml" "$DSH_HOME/settings.yaml"
npm run build
dsh plugin --profile web add .
npm run dev &        # Watch Node-side changes
npm run dev:client & # Watch browser-side changes
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

### Host-Only Debugging (with HMR)

```sh
npm run dev &
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

## Testing Standards

- Unit tests run against a mock Zotero HTTP service (`MockZotero`).
- Browser settings page tests use JSDOM and `@testing-library/react`.
- Coverage thresholds are defined in `vitest.config.ts`, with separate gates enforced for each core layer.
- Integration tests validate wire protocols and real data against an active Zotero instance.

## Release Checklist

Ensure all following checks pass before cutting a release:

1. `npm run harness:check -- --strict`: Version pin and upstream declarations are strictly aligned.
2. `npm run verify:pack`: Packed tarball includes all required files.
3. `npm test`: All tests pass.
4. `npm run typecheck`: Type check passes.
5. `npm run test:coverage`: Coverage meets all configured thresholds.
6. `npm run format:check`: Code style conforms to formatting rules.
7. `npm run build`: Production build succeeds.
8. Verify golden path scenarios (G1 through G8) in [Scenarios](scenarios.en.md); verify W1 through W4 as well if write operations are enabled.
