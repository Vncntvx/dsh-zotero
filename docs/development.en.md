<p align="right"><a href="development.md"><b>中文</b></a></p>

# dsh-zotero Development Guide

## Repository structure

```
src/
  index.ts              # Plugin entry (pure re-export)
  service.ts            # ZoteroService (Cordis service)
  provider-local.ts     # LocalApiProvider (Zotero Local API)
  http-client.ts        # HTTP transport (loopback fetch)
  config.ts             # Config schema and validation
  types.ts              # Domain types (DTOs)
  errors.ts             # Error class and error codes
  evidence.ts           # BM25 ranking
  attachments.ts        # Attachment selection
  refs.ts               # Zotero object reference syntax
  export-items.ts       # Per-document export parsing
  export-mapping.ts     # Ref → batch item mapping
  prompt.ts             # Model-facing policy section
  command.ts            # /zotero status command
  remote.ts             # Remote service for web tab
  typert.ts             # Typert manifest
  settings-namespace.ts # Settings namespace constants
  tools/                # 5 tool implementations
  client/               # Browser side (settings card, Sources tab)
tests/                  # Unit tests (mock Zotero server)
```

## Install and build

```sh
npm install --no-workspaces  # this repo lives inside the deepseek-harness workspace
npm test                     # unit tests (mock Zotero server + browser card tests)
npm run typecheck            # tsc --noEmit (node/test/client projects)
npm run build                # tsc + esbuild (node lib/ + browser lib/client.js)
npm run build:client         # rebuild browser side only
npm run test:coverage        # 100% coverage on src/
npm run format               # prettier --write
npm run format:check         # format check
```

> This repo is nested inside the deepseek-harness workspace and requires `npm install --no-workspaces`.

## Integration tests

```sh
npm run test:integration
# or: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

Requires a local Zotero running on `127.0.0.1:23119`.

## Two-part build

- **Node side** (`lib/`): tsc generates from TypeScript, contains service, tools, provider, transport.
- **Browser side** (`lib/client.js`): esbuild generates, contains settings card and Sources tab views.

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
- src/ 100% coverage (excluding src/index.ts and src/types.ts)
- Integration tests run against real Zotero, skipped by default

## Release checklist

- `npm test` passes
- `npm run typecheck` passes
- `npm run test:coverage` passes (100%)
- `npm run format:check` passes
- `npm run build` succeeds
- smoke.mjs passes after tarball install
- Integration tests pass when Zotero is available
