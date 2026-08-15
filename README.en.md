# dsh-zotero

<p align="center">
  <b>English</b> · <a href="README.md"><b>中文</b></a>
</p>

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives the Agent progressive access to a local [Zotero](https://www.zotero.org) library: discovery, metadata, evidence, citation. It adds five tools, one command, and one prompt section through existing harness seams.

## Requirements

- Zotero desktop with the local API enabled: **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"**.
- Read access is unauthenticated on `http://127.0.0.1:23119/api`. The plugin never writes to the library (V1 is read-only).
- Zotero ≥ 7 speaking local API version 3. Upgrade if the status command reports a version mismatch.

## Install

From a dsh checkout, build the package and install it into a profile:

```sh
cd dsh-zotero
npm install
npm run build
dsh plugin --profile <name> add ./dsh-zotero
```

Once published, install by package name:

```sh
dsh plugin --profile <name> add dsh-zotero
```

The plugin mounts itself as `zotero` with an empty config. It loads on the next `dsh web` or headless run with defaults.

## Tools

| Tool | Purpose |
| --- | --- |
| `zotero_search` | Discover candidates via Zotero's quick search (title/creator/year, or indexed full text with `everything`). Library-wide, or scoped to a collection or saved search by name or ref. |
| `zotero_get` | Read one item's metadata; `include` adds child notes, annotations, or attachments (lazy requests). |
| `zotero_retrieve` | Rank evidence passages (annotations, notes, abstract, full-text chunks) against a query with BM25. |
| `zotero_attachment` | Resolve an attachment to a verified on-disk path or a linked URL. |
| `zotero_export` | Per-ref HTML citations, a joined CSL bibliography, or `bibtex` / `biblatex` / `ris` / `csljson` exports. |

Every tool returns stable refs of the form `zotero://user/0/<item|attachment|annotation|collection|search>/<KEY>`, optionally qualified with `?server=<id>`. The qualifier records which Zotero database produced the ref. Using it against a different database fails closed instead of resolving same-key objects.

## Command

`/zotero status` reports connectivity, API/schema versions, and the instance's Server ID. This is the only health check. Ordinary calls fail with typed domain errors.

## Configuration

All values are `Config` fields changeable from the bundle's `config` block (e.g. via `dsh plugin config`). Defaults are shown.

| Field | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:23119/api` | Local API base URL. Plain loopback HTTP only. |
| `provider` | `local` | Provider id to select. |
| `timeoutMs` | `5000` | Per-request provider deadline. |
| `maxSearchResults` | `20` | Upper bound for `zotero_search` `limit`. |
| `maxEvidenceChars` | `6000` | Total character budget for retrieved evidence. |
| `maxEvidencePassages` | `4` | Upper bound for evidence passage counts. |
| `maxDetailChars` | `3000` | Character budget for `zotero_get` abstract previews. |
| `maxFulltextChars` | `250000` | Full text accepted into evidence ranking. |
| `maxResponseBytes` | `16777216` | Streaming byte bound for every API response. |
| `maxExportChars` | `1000000` | Export output hard limit. Never mid-truncated. |
| `defaultStyle` | `apa` | CSL style for citation/bibliography formats. |
| `defaultLocale` | `en-US` | CSL locale for citation/bibliography formats. |

## Development

```sh
npm install                      # uses a local npm cache
npm test                         # unit tests (mock Zotero server)
npm run test:coverage            # 100% coverage gate on src/
npm run typecheck                # tsc --noEmit, app + test projects
npm run build                    # emits lib/
```

Run against a real Zotero (integration tests are opt-in and skipped otherwise):

```sh
npm run test:integration
# or: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

## Running locally

The plugin runs in two environments: a dsh source checkout, or the npm-installed dsh.

### From a dsh source checkout

Build the checkout once (`pnpm install && pnpm run build`), then load the plugin source through the dev overlay:

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` points the plugin entry at the absolute `src/index.ts`. The dsh source launch loads that TypeScript entry through tsx, so the plugin requires no prebuild. Update the absolute path when the checkout location differs.

### With the npm-installed dsh

Two run modes exist for the npm-installed dsh.

**Resident instance**: pack a tarball and install it into a profile. The plugin runs from the tarball copy; code updates require re-packing and re-installing. Verify with the production-stack smoke:

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.1.0.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

Run the smoke inside the profile directory, so bare imports resolve from the profile's flat `node_modules`. It verifies `status`, `search`, `get`, `retrieve`, `export`, the policy prompt section, and tool registration; `SMOKE PASS` indicates the packed plugin passes the installed-path checks.

**Dev instance (hot swap)**: the `dev-lib.cordis.yml` overlay disables the profile's tarball copy (id `zotero`), inserts `zotero-dev` at this checkout's `lib/index.js`, and re-enables HMR. The production web profile disables loader HMR, and the HMR watch base sits in the profile directory, so the overlay sets `base` explicitly. When the build output changes, HMR disposes the old instance and re-constructs the plugin in the same process; dsh keeps running:

```sh
cd /Volumes/Work/deepseek-harness/dsh-zotero
npm run dev &                    # tsc --watch: rebuild lib on src changes
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

Hot swap affects only the instance started with `--patch`; the resident instance keeps running the tarball version.
