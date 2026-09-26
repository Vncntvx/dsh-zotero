<p align="right"><a href="development.md"><b>中文</b></a></p>

# dsh-zotero Development Guide

## Repository structure

```
src/
  index.ts              # Plugin entry (pure re-export)
  service.ts            # ZoteroService (Cordis service)
  local/provider.ts     # LocalApiProvider (Zotero Local API)
  local/*-domain.ts     # Domain pipelines (search/export/changes/browse/write, etc.) + detail/retrieve/attachment-location
  local/                # Also children-wire, note-format, identity, scope-directory, pagination, limits
  http-client.ts        # HTTP transport (loopback fetch)
  config.ts             # Config schema and validation (LOOPBACK_HOSTNAMES and friends)
  types.ts              # Domain types (DTOs)
  contract.ts           # Remote wire structural surface (types, endpoint constants; no codecs)
  status-codec.ts       # Host-side strict codec (zod); the client arm lives in src/client/status-codec.ts
  errors.ts             # Error class and error codes
  json.ts               # Lossless JSON read helper
  constants.ts          # Domain constants (write tool names, authorize path, limits)
  concurrency.ts        # Bounded concurrency
  evidence.ts           # BM25 ranking
  search-text.ts        # Search folding aligned with Zotero normalizeForSearch
  attachments.ts        # Attachment selection
  local/children-wire.ts # Local API child-object contracts: bare /children (notes/attachments) and ?itemType=annotation (annotations)
  normalize.ts          # Zotero item → domain DTO normalization
  presentation-meta.ts  # Display projection of tool results
  refs.ts               # Zotero object reference syntax
  ref-grammar.ts        # Reference text patterns
  export-items.ts       # Per-document export parsing
  export-mapping.ts     # Ref → batch item mapping
  ask.ts                # User-question fallback when the connection fails (one card per failure kind, shared by parallel calls)
  prompt.ts             # Model-facing policy section
  command.ts            # /zotero command (status is an equivalent spelling)
  write-approval.ts     # Write plan card (the confirmation layer of the ctx.zotero seam)
  write-auth.ts         # Zotero local write-key acquisition and persistence
  write-http.ts         # Local API write transport (Server-ID + key + batches)
  shell-write-detector.ts # Detector for shell writes to the local API (tools/pre-execute → ask)
  remote.ts             # Remote service for web tab
  typert.ts             # Typert manifest
  settings-namespace.ts # Settings namespace constants
  tools/                # 11 model tools (8 read + create_note/add_tags/add_to_collection) + present/validate shared pieces
  client/               # Browser side (settings page, Sources tab, sources reducers, workspace views)
tests/                  # Unit tests (mock Zotero server + browser page tests)
```

## Install and build

```sh
npm install                  # sibling of deepseek-harness; add --no-workspaces only for a nested copy
npm test                     # unit tests (mock Zotero server + browser card tests)
npm run typecheck            # upstream dependency state check + tsc --noEmit (node/test/client projects)
npm run build                # tsc + esbuild (node lib/ + browser lib/client.js)
npm run build:client         # rebuild browser side only
npm run test:coverage        # coverage gate (global 97/95/98/97 plus per-layer ratchets, see vitest.config.ts)
npm run harness:check        # upstream pin and declaration freshness (typecheck already runs it)
npm run harness:pin -- <ver> # move the whole pin to <ver> (devDeps/overrides/peers/engines/README/AGENTS)
npm run verify:pack          # assert the packed tarball carries the declared entries
npm run format               # prettier --write
npm run format:check         # format check
```

> This repo sits beside deepseek-harness as a sibling (see AGENTS.md): plain `npm install`. Add `--no-workspaces` only when nested inside the harness workspace.
>
> Upstream **types** come from the built `lib/types` artifacts of the sibling checkout that `node_modules/@deepseek-ai/*` symlinks at (the same read a published consumer makes). A sibling `git pull` does not regenerate them, so `npm run typecheck` first runs `node scripts/harness-state.mjs`: when an imported package's `src` is newer than its declaration file, it prints the build command to run. `npm run harness:check -- --strict` (used by the release check) turns that report into a failure.

## Integration tests

```sh
npm run test:integration
# or: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

Requires a local Zotero running on `127.0.0.1:23119`.

## Two-part build

- **Node side** (`lib/`): tsc generates from TypeScript, contains service, tools, provider, transport.
- **Browser side** (`lib/client.js`): esbuild generates, contains settings page and Sources tab views.

## Local development

### From dsh source

```sh
pnpm install && pnpm run build   # build dsh first
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

### With npm-installed dsh

Three approaches:

1. **Tarball install verification**:

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

2. **Node-side hot reload**:

```sh
npm run dev &                     # tsc --watch
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

3. **Browser-side development**:

```sh
npm run dev:client                # esbuild watch
# the checkout must be installed into the profile for the browser side to load
```

## Testing

- Unit tests use MockZotero (mock HTTP server)
- Browser card tests use jsdom + @testing-library/react
- Coverage gate lives in `vitest.config.ts`: global 97 statements / 95 branches / 98 functions / 97 lines, plus per-layer ratchets (`src/*.ts`, `src/local/**`, `src/tools/**`, `src/client/**`, and others). Types-only and pure re-export modules are listed in `exclude` (`src/index.ts`, `src/types.ts`, `css-modules.d.ts`, `sources/model.ts`, and others)
- Integration tests run against real Zotero, skipped by default

## Release checklist

- `npm run harness:check -- --strict` passes (pin consistent, upstream declarations not behind the sibling source)
- `npm run verify:pack` passes (tarball carries `lib/index.js`, `lib/index.d.ts`, `lib/client.js`, `cordis.patch.yml`)
- `npm test` passes
- `npm run typecheck` passes
- `npm run test:coverage` passes (gate above)
- `npm run format:check` passes
- `npm run build` succeeds
- smoke.mjs passes after tarball install
- Integration tests pass when Zotero is available
- Walk the [scenarios](scenarios.en.md) golden path (G1–G8); run W1–W4 as well when write is enabled
