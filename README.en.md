# dsh-zotero

<p align="center">
  <b>English</b> · <a href="README.md"><b>中文</b></a>
</p>

Let agents search, read, and cite your local [Zotero](https://www.zotero.org) library: find papers, browse notes and annotations, pull evidence by question, open the source document, generate citations.

Describe what you need in a session and the Agent calls the tools below as needed. The only manual command is `/zotero status`.

## Tools

| Tool                | Purpose                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `zotero_search`     | Discover: search by title/creator/year, or indexed full text with `everything`; optionally scope to a collection or saved search.     |
| `zotero_get`        | Inspect: read one item's structured core metadata, optionally with manifests and previews of its notes, annotations, and attachments. |
| `zotero_retrieve`   | Evidence: return the most relevant bounded evidence passages (annotations, notes, abstract, full-text chunks) for a query.            |
| `zotero_attachment` | Source: resolve an item or attachment ref to the original attachment's verified on-disk path or linked URL.                           |
| `zotero_export`     | Cite: let Zotero's own citation/export machinery produce citations, a CSL bibliography, or `bibtex` / `biblatex` / `ris` / `csljson`. |

## Usage example

The Agent moves down the ladder as a request deepens. A typical conversation:

> User: "Find papers about FlashAttention."
> Agent → `zotero_search`, returning candidates with refs.
>
> User: "What is the first one? Have I read it before?"
> Agent → `zotero_get`: metadata, 17 annotations, 2 notes, limited previews.
>
> User: "What did I think about its evaluation?"
> Agent → `zotero_retrieve(query:"evaluation", sources:["annotations","notes"])`, returning matching note and annotation evidence.
>
> User: "How does the paper itself explain memory efficiency?"
> Agent → `zotero_retrieve(query:"memory efficiency", sources:["fulltext","abstract"])`, returning abstract and full-text passages.
>
> User: "Show me the original PDF."
> Agent → `zotero_attachment(item ref)`, returning the verified file path; if the composition has a PDF/file reader, the Agent hands it off for further analysis.
>
> User: "Generate an APA bibliography for these three."
> Agent → `zotero_export(format:"bibliography", style:"apa")`.

## Command

`/zotero status` reports connectivity, API/schema versions, and the database identity (Server ID, Zotero 10+). This is the only health check. Ordinary calls fail with typed domain errors.

## On-demand work and connectivity-failure interaction

- The plugin is resident but strictly request-driven: loading, idling, and unloading never issue a request (no probes, no polling, no background work). Only two entry points touch Zotero: the five tools, invoked when the user explicitly asks about their library, and the explicitly invoked `/zotero status` command.
- When a tool call fails with a connectivity error (`ZOTERO_NOT_RUNNING` not running / `ZOTERO_API_DISABLED` local API disabled / `ZOTERO_API_VERSION` unsupported version / `ZOTERO_TIMEOUT` timed out), the plugin asks the user how to proceed through an interactive question card: the first option is the recommended action marked `(Recommended)` (e.g. "I started Zotero, retry (Recommended)"); choosing it re-runs the same request once, and a second failure or the "Abort this query" choice surfaces the original typed error — never a second question.
- Without an interactive provider (headless compositions), the ask is skipped and the typed error is returned as-is; a failing question mechanism never masks the original connectivity error.

## Limits

- Read-only library: no path modifies items, notes, tags, or collections.
- Full-text evidence depends on Zotero's index: `everything` search and `retrieve` full-text passages both require indexing.
- Note-content search is a client-side scan: library/collection scopes and the first result page only, bounded by `maxNoteScanRecords`; notes beyond the cap never match.
- Attachment depth depends on the harness composition: `zotero_attachment` returns the file location; reading that PDF further needs a matching file/PDF capability.
- Evidence ranking is term-based relevance, not embedding or semantic search.

## Requirements

- Zotero desktop with the local API enabled: **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"**.
- Read access is unauthenticated on `http://127.0.0.1:23119/api`. V1 has no path that modifies library data (items, notes, tags, collections).
- Zotero ≥ 7 speaking local API version 3. Upgrade if the status command reports a version mismatch.

## Install

### By package name

```sh
dsh plugin --profile <name> add dsh-zotero
```

The tarball ships the built `lib/` (the node half plus the browser half `lib/client.js`); no local build is needed. The browser half is the configuration card: dsh web scans the package's `dsh.client` manifest and mounts it automatically, with no extra setup.

### From a local tarball

```sh
cd dsh-zotero
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.1.0.tgz
```

`npm pack` runs `prepare` first, so the tarball carries a fresh `lib/`. Use this for unpublished or local trial installs.

### From the GitHub source

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero
```

A git install fetches sources instead of built artifacts, so pnpm installs the dependencies and then runs this package's `prepare` to build in place (TypeScript and `@types/node` live in `dependencies`). pnpm ≥ 10 refuses to run a git dependency's `prepare` by default, so the first `add` fails and points at the fix: add the package key to the profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-zotero: true
```

`allowBuilds` grants permission to run the package's code on your machine at install time. Only allow sources you trust, and prefer pinning a commit (`github:Vncntvx/dsh-zotero#<sha>`).

The plugin mounts as id `zotero` and takes effect on the next dsh start. After installing or enabling the plugin, start a new session if the current one was created before the plugin loaded, so the Agent picks up the Zotero tools.

## Configuration

All values are `Config` fields changeable from the bundle's `config` block (e.g. via `dsh plugin config`). Defaults are shown.

| Field                  | Default                      | Meaning                                                                                                        |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Local API base URL. Plain loopback HTTP only.                                                                  |
| `provider`             | `local`                      | Provider id to select.                                                                                         |
| `timeoutMs`            | `5000`                       | Per-request provider deadline.                                                                                 |
| `maxSearchResults`     | `20`                         | Upper bound for `zotero_search` `limit`.                                                                       |
| `maxNoteScanRecords`   | `200`                        | Upper bound for note records scanned for body matches by `zotero_search`.                                      |
| `maxEvidenceChars`     | `6000`                       | Total character budget for retrieved evidence.                                                                 |
| `maxEvidencePassages`  | `4`                          | Upper bound for evidence passage counts.                                                                       |
| `maxDetailChars`       | `3000`                       | Character budget for `zotero_get` abstract previews.                                                           |
| `maxNoteBodyChars`     | `30000`                      | Character budget for a note item's own body returned by `zotero_get`.                                          |
| `maxNoteChars`         | `2000`                       | Character budget per note preview in `zotero_get`.                                                             |
| `maxNoteRecords`       | `50`                         | Upper bound for note records returned by `zotero_get`.                                                         |
| `maxAnnotationRecords` | `100`                        | Upper bound for annotation records returned by `zotero_get`.                                                   |
| `fulltextChunkWords`   | `200`                        | Word count per full-text passage entering evidence ranking.                                                    |
| `maxFulltextChars`     | `250000`                     | Full text accepted into evidence ranking.                                                                      |
| `maxResponseBytes`     | `16777216`                   | Streaming byte bound for every API response.                                                                   |
| `maxExportChars`       | `1000000`                    | Export output hard limit. Never mid-truncated.                                                                 |
| `maxExportRefs`        | `1000`                       | Upper bound for refs in one `zotero_export` call; keeps the request line under the server's HTTP header limit. |
| `defaultStyle`         | `apa`                        | CSL style for citation/bibliography formats.                                                                   |
| `defaultLocale`        | `en-US`                      | CSL locale for citation/bibliography formats.                                                                  |

### Web configuration

The plugin registers a "Zotero" card in dsh web's **Settings → Plugins → Plugin configuration** page listing all 19 fields above. The card binds the `zotero` settings namespace: writes land in the `zotero:` section of `$DSH_HOME/settings.yaml` (layered over the patch entry's `config`, user layer wins), and **saves apply live** — the transport and the provider rebuild on the new values, so the next tool call or `/zotero status` uses them without a dsh restart.

- Invalid values (a non-loopback `baseUrl`, a non-positive limit) are refused before the write; the card reports the failed save and keeps the draft, and the plugin keeps running on the last valid value.
- Every field shows its effective value; fields overridden by the settings document carry an "Overridden" badge and offer a one-click reset (clears the user layer, back to the patch entry value).
- External edits to the settings document (e.g. editing `settings.yaml` directly) hot-apply too.
- Compositions without a settings service (pure headless) never register the namespace, and the plugin behaves exactly as if unconfigured.

## Development

### Commands

```sh
npm install                      # uses a local npm cache (see the workspace note below)
npm test                         # unit tests (mock Zotero server + browser card tests)
npm run test:coverage            # 100% coverage gate on src/
npm run typecheck                # tsc --noEmit, node / test / client projects
npm run build                    # tsc emits the node half into lib/; esbuild emits the browser half lib/client.js
npm run build:client             # rebuild the browser half only (self-checks the loader handoff)
npm run dev:client               # watch the browser half (pair with the hot-swap overlay)
npm run format                   # prettier --write across the repo
npm run format:check             # verify formatting (run before committing)
```

> This checkout sits inside the deepseek-harness workspace tree: the parent `package.json` declares `workspaces`, so npm walks up to it and tries to install the whole workspace. Run `npm install --no-workspaces` instead (or drop a `.npmrc` with `workspaces=false` in this repository).

Integration tests run against a live Zotero and stay skipped unless enabled:

```sh
npm run test:integration
# or: ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

### Running locally

#### From a dsh source checkout

Build the checkout once (`pnpm install && pnpm run build`), then load the plugin source through the dev overlay:

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` points the plugin entry at the absolute `src/index.ts`. The dsh source launch loads that TypeScript entry through tsx, so the plugin requires no prebuild. Update the absolute path when the checkout location differs.

#### With the npm-installed dsh

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

**Developing the browser half**: the web frontend only scans loader rows whose `name` is a bare package name (resolvable to `package.json`) — the absolute-path row in `dev-lib.cordis.yml` has no browser half, so the card does not appear in the dev instance. To develop the card, install this checkout into the profile (`npm install <this repo path>` as a file: dependency, or pack and install the tarball), then pair `npm run dev:client` (esbuild watch) with the hot-swap overlay: browser-bundle changes make HMR re-fetch `/plugins/dsh-zotero/client.js`.

## License

MIT. See [LICENSE](./LICENSE).
