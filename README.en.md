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
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2"><img src="https://img.shields.io/badge/dsh-0.2.0--rc.2-blue" alt="dsh version" style="max-width:100%;"></a>
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

## Install

From npm (recommended):

```sh
dsh plugin --profile <name> add dsh-zotero
```

From GitHub prebuilt branch:

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero#release
```

> **Installing from main branch**: Installing directly from `github:Vncntvx/dsh-zotero` (default `main` source branch) runs the `prepare` build script locally, which pnpm blocks by default under supply-chain security policies until added to `allowBuilds` in `pnpm-workspace.yaml`. Use the `#release` branch for zero-configuration prebuilt installation.

From a local tarball:

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
```

After installing, start a new session so the agent picks up the Zotero tools.

The plugin provides a settings page under **Settings → Zotero** — a left-nav entry beside General, Models, and Plugins — where you can adjust the API address, concurrency limits, full-text retrieval toggle, and more. Changes take effect on save. See [Configuration](docs/configuration.en.md).

[Installation details →](docs/getting-started.en.md)

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

## Requirements

- Zotero ≥ 7 supports reads; writes require Zotero 10. Enable the local API: **Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"**
- Node.js ≥ 22.19 (or ≥ 24)
- dsh >= 0.2.0-rc.2 host (`engines.dsh` and every `@deepseek-ai/dsh-*` peer declare `>= 0.2.0-rc.2`, compatible with this and future higher versions)
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

## Limitations

- **Read-only by default**: Write tools (create note, add tags, add to collection) are available only when `writeEnabled` is turned on. Every write operation requires approval through the host confirmation card and local Zotero authorization.
- **Keyword-based retrieval**: Passage search uses BM25 term matching rather than vector semantic search. Full-text search relies on Zotero's local index; unindexed PDFs will not return text passages.
- **Attachment handling**: `zotero_attachment` verifies and returns local attachment paths. Reading or processing PDF contents depends on the host's document handling capabilities.
- **Static exports**: Export tools return plain text (such as BibTeX, RIS, or CSL JSON), which can be copied or downloaded directly from the Zotero panel.

## Permissions

- **Network**: HTTP requests are restricted to the local `http://127.0.0.1:23119/api` loopback address. The plugin follows no redirects and makes no outbound network connections.
- **Filesystem and processes**: Read-only access to local attachment paths (verified via async `stat`). The plugin executes no shell commands, loads no native binary modules, and spawns no background daemons.
- **Persistence**: Plugin configuration is stored in `$DSH_HOME/settings.yaml`. If "Always Allow" is selected during write authorization, the issued key is stored in the host credentials store.
- **Lifecycle**: Configuration changes hot-reload immediately upon save; installing or removing the plugin requires restarting the host application.

## Documentation

| Doc                                           | Covers                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| [Getting Started](docs/getting-started.en.md) | Installation, prerequisites, first verification         |
| [Features](docs/features.en.md)               | Sources panel, chat integration, evidence, exports      |
| [Tool Reference](docs/tools.en.md)            | Parameters, return values, error codes for all 11 tools |
| [Configuration](docs/configuration.en.md)     | 24 config fields, defaults, hot-reload                  |
| [Architecture](docs/architecture.en.md)       | Data flow, layer responsibilities, design boundaries    |
| [Development](docs/development.en.md)         | Build, test, local development                          |
| [Scenarios](docs/scenarios.en.md)             | Real-conversation acceptance cases and everyday prompts |
| [Troubleshooting](docs/troubleshooting.en.md) | 12 common issues with symptoms and fixes                |

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
