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

## Testing with an installed dsh

The npm-installed `dsh` can verify the production path end to end: pack the plugin, install the tarball into a throwaway profile, and run the production-stack smoke against a live Zotero.

```sh
npm pack
dsh plugin --profile zotero-smoke add ./dsh-zotero-0.1.0.tgz
cd ~/.dsh/profiles/zotero-smoke
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

The smoke runs inside the profile directory so bare imports resolve from the profile's flat `node_modules` — the exact dependency stack the npm dsh ships — and exercises `status`, `search`, `get`, `retrieve`, `export`, the policy prompt section, and tool registration against Zotero's real Local API. `SMOKE PASS` means the packed plugin works as installed.

From a DeepSeek Harness source checkout, load the plugin through the dev overlay without installing:

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` points at the absolute `src/index.ts` path. Adjust it for your checkout.
