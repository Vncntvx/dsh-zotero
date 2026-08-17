<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=18&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Zotero+as+an+evidence+store+for+agents."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.md"><b>中文</b></a> · <b>English</b>
</p>

Let agents discover sources in your [Zotero](https://www.zotero.org) library, extract the evidence relevant to a question, and always keep the link between evidence and the source document.

dsh-zotero is built for agent research workflows: from literature search and metadata/note inspection to evidence retrieval, opening the source, and citation generation, the Agent pulls what the current task needs step by step — without reading a whole paper or the whole library up front.

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

## Requirements

- Zotero desktop with the local API enabled: **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"**.
- Read access is unauthenticated on `http://127.0.0.1:23119/api`. V1 has no path that modifies library data (items, notes, tags, collections).
- Zotero ≥ 7 speaking local API version 3. Upgrade if the status command reports a version mismatch.
- Node.js ≥ 22.19 (or 24+); the host dsh runtime is the rc.7 line. Runtime peer dependencies are declared in `package.json` `peerDependencies` (`@deepseek-ai/cordis` ≥ 4, `dsh-tools`, `dsh-llm`, `dsh-settings`, `dsh-user-questions`, `dsh-typert-protocol`, `dsh-typert-registry`, `dsh-api-remotes`, `dsh-commands`, `dsh-timeout`), all currently `^0.1.0-rc.7`.

### Capability boundary and side effects

- Network: only the loopback-forced `http://127.0.0.1:23119/api` (redirects refused, streaming byte bound); no external network calls.
- Files: only `existsSync` checks of attachment disk paths — never written, never executed.
- Process: no shell calls, no native modules, no resident background tasks or timers — every request is driven by a tool call, and loading the plugin never probes Zotero.
- External side effects: the only persistent write is the settings card saving the `zotero:` section (user layer) of `$DSH_HOME/settings.yaml`; no telemetry.

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
dsh plugin --profile <name> add ./dsh-zotero-0.3.1.tgz
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

| Field                  | Default                      | Meaning                                                                                                                                          |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Local API base URL. Plain loopback HTTP only.                                                                                                    |
| `provider`             | `local`                      | Provider id to select.                                                                                                                           |
| `timeoutMs`            | `5000`                       | Per-request provider deadline.                                                                                                                   |
| `maxSearchResults`     | `20`                         | Upper bound for `zotero_search` `limit`.                                                                                                         |
| `maxNoteScanRecords`   | `200`                        | Upper bound for note records scanned for body matches by `zotero_search`.                                                                        |
| `maxEvidenceChars`     | `6000`                       | Total character budget for retrieved evidence.                                                                                                   |
| `maxEvidencePassages`  | `4`                          | Upper bound for evidence passage counts.                                                                                                         |
| `maxDetailChars`       | `3000`                       | Character budget for `zotero_get` abstract previews.                                                                                             |
| `maxNoteBodyChars`     | `30000`                      | Character budget for a note item's own body returned by `zotero_get`.                                                                            |
| `maxNoteChars`         | `2000`                       | Character budget per note preview in `zotero_get`.                                                                                               |
| `maxNoteRecords`       | `50`                         | Upper bound for note records returned by `zotero_get`.                                                                                           |
| `maxAnnotationRecords` | `100`                        | Upper bound for annotation records returned by `zotero_get`.                                                                                     |
| `fulltextChunkWords`   | `200`                        | Word count per full-text passage entering evidence ranking.                                                                                      |
| `maxFulltextChars`     | `250000`                     | Full text accepted into evidence ranking.                                                                                                        |
| `maxResponseBytes`     | `16777216`                   | Streaming byte bound for every API response.                                                                                                     |
| `maxExportChars`       | `1000000`                    | Export output hard limit. Never mid-truncated.                                                                                                   |
| `maxExportRefs`        | `50`                         | Upper bound for refs in one `zotero_export` call; citation batches past the API's 50-key per-request cap.                                        |
| `defaultStyle`         | `apa`                        | CSL style for citation/bibliography formats.                                                                                                     |
| `defaultLocale`        | `en-US`                      | CSL locale for citation/bibliography formats.                                                                                                    |
| `webEnabled`           | `true`                       | Enables the dedicated Zotero tab at the top of the session; the toggle applies live — turning it off hides the tab right away, no reload needed. |

### Web configuration

The plugin registers a "Zotero" card in dsh web's **Settings → Plugins → Plugin configuration** page listing every field in the table above. The card binds the `zotero` settings namespace: writes land in the `zotero:` section of `$DSH_HOME/settings.yaml` (layered over the patch entry's `config`, user layer wins), and **saves apply live** — the transport and the provider rebuild on the new values, so the next tool call or `/zotero status` uses them without a dsh restart.

- Invalid values (a non-loopback `baseUrl`, a non-positive limit) are refused before the write; the card reports the failed save and keeps the draft, and the plugin keeps running on the last valid value.
- Every field shows its effective value; fields overridden by the settings document carry an "Overridden" badge and offer a one-click reset (clears the user layer, back to the patch entry value).
- External edits to the settings document (e.g. editing `settings.yaml` directly) hot-apply too.
- Compositions without a settings service (pure headless) never register the namespace, and the plugin behaves exactly as if unconfigured.

### Web view

The dsh web session view is a tab ring (Chat, Trajectory, …). The plugin registers a dedicated **Zotero** tab (`conversation.view`, id `zotero`, after Trajectory and dsh-context) and leaves dsh's built-in chat and trajectory display untouched:

- A **connection strip** leads the tab: one status probe on mount, another per explicit Refresh (request-driven, no polling timers); it shows the connection state, API/schema versions, Server ID (Zotero 10+), and the last-checked time, with the diagnosis when Zotero is unavailable.
- Below it, the session's **Zotero tool activity**: every search, read, retrieve, attachment, and export call renders as a rich card (expandable, copyable refs, evidence passages labeled by source), fully replay-driven from the conversation snapshot — the same transcript renders the same cards, and missing meta degrades to the raw content.
- The **Web → Session tool cards** toggle in the settings page (`webEnabled`, default on) controls the tab's registration; the toggle applies live — turning it off hides the tab immediately, no reload needed. When off, Zotero calls show as dsh's built-in generic cards in the trajectory.

## Limits

- Read-only library: no path modifies items, notes, tags, or collections.
- Full-text evidence depends on Zotero's index: `everything` search and `retrieve` full-text passages both require indexing.
- Note-content search is a client-side scan: library/collection scopes and the first result page (offset 0) only, bounded by `maxNoteScanRecords`; matches fill the first page up to the limit and are reported in the `noteMatches` field, outside the paged `total`.
- Attachment depth depends on the harness composition: `zotero_attachment` returns the file location; reading that PDF further needs a matching file/PDF capability.
- Evidence ranking is term-based relevance, not embedding or semantic search.

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

This plugin builds in two halves: the **Node side** (`lib/`, emitted by `tsc`, holds the service, tools, provider, and other logic) and the **browser side** (`lib/client.js`, emitted by `esbuild`, holds the dsh web configuration card and the Zotero tab view). The three flows below cover the common cases.

**① Resident instance verification (tarball install)**

Pack a tarball and install it into a profile. The plugin runs from the tarball's built artifacts; code updates require re-packing and re-installing. Verify with the production-stack smoke after install:

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.3.1.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

The smoke must be run inside the profile directory, so bare imports resolve from the profile's flat `node_modules`. It verifies `status`, `search`, `get`, `retrieve`, `export`, the policy prompt section, and the registration of all five tools; `SMOKE PASS` indicates the packed plugin passes the installed-path checks.

**② Node-side hot-swap development**

The `dev-lib.cordis.yml` overlay disables the profile's tarball row (id `zotero`), inserts a `zotero-dev` row pointing at this checkout's `lib/index.js`, and re-enables HMR. The production web profile disables loader HMR by default, and HMR's watch root lives in the profile directory, so the overlay sets `base` explicitly. When the build output changes, HMR disposes the old instance and reconstructs the plugin in the same process — no dsh restart needed:

```sh
cd ./dsh-zotero                 # from the deepseek-harness checkout
npm run dev &                    # tsc --watch: rebuild lib on src changes
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

Hot swap only affects the instance started with `--patch`; the resident instance keeps running the tarball version, independently.

**③ Browser-side development**

The web frontend only scans loader rows whose `name` is a bare package name (npm-resolvable to `package.json`) to load the browser-side bundle. `dev-lib.cordis.yml` uses an absolute-path row, which does not trigger browser-side loading, so the card does not appear in the ② dev instance. To develop the card, first install this checkout into the profile (`npm install <this repo path>` as a `file:` dependency, or pack and install the tarball), then pair `npm run dev:client` (esbuild watch) with the hot-swap overlay: browser-bundle changes make HMR re-fetch `/plugins/dsh-zotero/client.js`.

## License

MIT. See [LICENSE](./LICENSE).
