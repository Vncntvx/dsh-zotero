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
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2"><img src="https://img.shields.io/badge/dsh-0.1.7--rc.2-blue" alt="dsh version" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.md"><b>中文</b></a> · <b>English</b>
</p>

dsh-zotero is a [Zotero](https://www.zotero.org) plugin designed for agent research workflows. Agents can search your library directly, view metadata and notes, extract evidence passages relevant to a question, open source PDFs, and generate citations and bibliographies.

<p align="center">
  <img src="docs/images/header-collage.png" width="70%" alt="dsh-zotero UI: sources panel, evidence extraction, export view">
</p>

## Tools

| Tool                | Purpose                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `zotero_search`     | Search by title/creator/year (library/collection/savedSearch/publications scopes); `everything` mode also searches indexed full text |
| `zotero_browse`     | Discover library structure: libraries, the collection tree, saved searches, tag facets, item types and their fields                  |
| `zotero_get`        | Read one item's metadata, optionally with notes, annotations, and attachments; `fields:"all"` keeps every field                      |
| `zotero_children`   | Explore one item's child-object graph: direct notes, attachments, and the annotations that live under each PDF                       |
| `zotero_retrieve`   | Return the most relevant evidence passages for a query; multi-attachment retrieval supported                                         |
| `zotero_changes`    | Incremental awareness via local transaction versions: what changed, what was deleted                                                 |
| `zotero_attachment` | Resolve a ref to a verified on-disk path or linked URL                                                                               |
| `zotero_export`     | Generate citations, bibliographies, BibTeX/BibLaTeX/RIS/CSL JSON                                                                     |

[Full tool reference →](docs/tools.md)

## Install

```sh
dsh plugin --profile <name> add dsh-zotero
```

From GitHub source:

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero
```

From a local tarball:

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
```

After installing, start a new session so the agent picks up the Zotero tools.

The plugin provides a settings page under **Settings → Zotero** — a left-nav entry beside General, Models, and Plugins — where you can adjust the API address, concurrency limits, full-text retrieval toggle, and more. Changes take effect on save. See [Configuration](docs/configuration.en.md).

[Installation details →](docs/getting-started.en.md)

## Requirements

- Zotero ≥ 7 supports reads; writes require Zotero 10. Enable the local API: **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"**
- Node.js ≥ 22.19 (or ≥ 24)
- dsh 0.1.7-rc.2 host (exactly this version: `engines.dsh` and every `@deepseek-ai/dsh-*` peer pin that exact version; no other dsh release is supported)
- Local API at `http://127.0.0.1:23119/api`; reads are unauthenticated, while Zotero 10 writes use a locally issued write key

## Usage example

The agent calls tools step by step during a conversation. Each result becomes context for the next step.

```text
User: Find papers about Risk
Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
       5 matches; user picks the first 3

User: What does the first one's abstract say?
Agent → zotero_get(ref: "zotero://user/0/item/ABCD1234")
       Returns the full abstract (the standard model carries it)

User: Find the methodology discussion in this paper
Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology",
                        sources: ["fulltext", "note"])
       Returns relevant passages with page numbers

User: Export all three as BibTeX
Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234",
                             "zotero://user/0/item/EFGH5678",
                             "zotero://user/0/item/IJKL9012"], format: "bibtex")
       Generates BibTeX entries; the UI can download them, the model reads the same text
```

More examples in [Features](docs/features.en.md).

## Limits

- **Read-only by default**: after `writeEnabled` is explicitly enabled, three write tools can create research notes, add tags, or add personal-library items to collections; every write first shows a plan card for approval (there is no switch to turn it off), plus Zotero 10 local authorization
- **Loopback only**: network requests go only to `127.0.0.1:23119`
- **Evidence ranking is term-based**: BM25 ranks passages by query-term frequency match
- **Exports are static text**: the tool returns text, and that is what the model reads; the Zotero panel offers one-click copy or file download (`.bib`, `.ris`, `.json`), so nothing has to be retyped
- **Full-text evidence depends on Zotero's index**: unindexed PDFs yield no full-text passages
- **Attachment depth depends on the harness**: `zotero_attachment` returns the file location; reading the PDF further needs a matching host capability

## Permissions and external side effects

- **Network**: HTTP requests go only to `http://127.0.0.1:23119/api` (redirects are not followed); `resolveConfig` enforces a loopback address
- **Filesystem**: read-only — `zotero_attachment` verifies attachment paths with `existsSync`; no file writes
- **Persistence**: settings save under the `zotero:` user layer of `$DSH_HOME/settings.yaml`; an Always-Allow Zotero write key is also stored in the host credentials service bound to its issuing instance
- **No shell / native / background tasks**: the plugin runs no shell commands, loads no native modules, and starts no daemon
- **Restart**: after installing or removing the plugin, restart dsh and start a new session; configuration changes hot-reload on save without a restart

## Documentation

| Doc                                           | Covers                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| [Getting Started](docs/getting-started.en.md) | Installation, prerequisites, first verification         |
| [Features](docs/features.en.md)               | Sources panel, chat integration, evidence, exports      |
| [Tool Reference](docs/tools.en.md)            | Parameters, return values, error codes for all 11 tools |
| [Configuration](docs/configuration.en.md)     | 25 config fields, defaults, hot-reload                  |
| [Architecture](docs/architecture.en.md)       | Data flow, layer responsibilities, design boundaries    |
| [Development](docs/development.en.md)         | Build, test, local development                          |
| [Troubleshooting](docs/troubleshooting.en.md) | 11 common issues with symptoms and fixes                |

## Development

```sh
npm install                  # sibling of ../deepseek-harness; add --no-workspaces only for a nested copy
npm test                      # vitest unit tests against the mock Zotero server
npm run typecheck             # tsc --noEmit for node, test, and client projects
npm run build                 # tsc emits node half into lib/; esbuild emits browser half lib/client.js
npm run dev                   # tsc --watch for host half hot reload
npm run dev:client            # esbuild --watch for browser half hot reload
```

Build output splits into `lib/` (Node side) and `lib/client.js` (browser side — settings page + Zotero tab). For full plugin development with both halves, use the `dev-lib.cordis.yml` overlay. See [Development](docs/development.md) for details.

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
