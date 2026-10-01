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

dsh-zotero is a [Zotero](https://www.zotero.org) plugin designed for agent research workflows. Agents can search your library directly, read metadata and notes, extract relevant evidence passages, locate source PDFs, and generate citations and bibliographies.

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

> **Installing from main branch**: Installing directly from `github:Vncntvx/dsh-zotero` (default `main` source branch) executes build scripts locally. Because pnpm blocks dependency builds by default, you must configure `allowBuilds` in `pnpm-workspace.yaml`. Use the `#release` branch for zero-configuration prebuilt installation.

From a local tarball:

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
```

After installation, start a new session to use Zotero tools.

The plugin provides a configuration page under **Settings → Zotero**, supporting adjustments for API address, concurrency limits, full-text retrieval, and other parameters. Changes take effect on save. See [Configuration Reference](docs/configuration.en.md).

[Getting Started →](docs/getting-started.en.md)

## Tools

| Tool                | Purpose                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `zotero_search`     | Search by title, author, year, or full-text index across library, collection, saved-search, and publication scopes |
| `zotero_browse`     | Discover library structure: libraries, collection tree, saved searches, tag facets, item types and fields          |
| `zotero_get`        | Read structured metadata for a single item, optionally including notes, annotations, and attachments               |
| `zotero_children`   | Explore an item's child-object graph: direct notes, attachments, and PDF annotations                               |
| `zotero_retrieve`   | Extract query-ranked evidence passages using BM25, supporting multi-attachment retrieval                           |
| `zotero_changes`    | Track incremental changes and deletions based on local transaction versions                                        |
| `zotero_attachment` | Resolve an item or attachment ref to a verified local file path or URL                                             |
| `zotero_export`     | Generate formatted citations, bibliographies, and BibTeX, BibLaTeX, RIS, or CSL JSON exports                       |

[Tool Reference →](docs/tools.en.md)

## Prerequisites

- Zotero ≥ 7 desktop (reads require Zotero ≥ 7; writes require Zotero 10). Enable local API: **Settings → Advanced → Allow other applications on this computer to communicate with Zotero**.
- Node.js ≥ 22.19 or ≥ 24
- Host dsh ≥ 0.2.0-rc.2
- Local API at `http://127.0.0.1:23119/api`; reads require no authentication, while writes use a locally issued write key

## Usage Example

The agent calls tools during the conversation as needed, using outputs as context for subsequent steps:

```text
User: Find papers about Risk
Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
       5 matches; user picks the first 3

User: What does the first one's abstract say?
Agent → zotero_get(ref: "zotero://user/0/item/ABCD1234")
       Returns full abstract

User: Find the methodology discussion in this paper
Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology",
                        sources: ["fulltext", "note"])
       Returns relevant passages with page labels and source tags

User: Export all three as BibTeX
Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234",
                             "zotero://user/0/item/EFGH5678",
                             "zotero://user/0/item/IJKL9012"], format: "bibtex")
       Generates BibTeX entries; copy or download directly in the UI
```

More examples in [Features](docs/features.en.md).

## Limitations

- **Read-only by default**: Write tools (create note, add tags, add to collection) are available only when `writeEnabled` is turned on. Every write operation requires approval through the confirmation card and local Zotero authorization.
- **Keyword-based retrieval**: Passage search uses BM25 term frequency matching. Full-text search relies on Zotero's local index; unindexed PDFs will not return text passages.
- **Attachment handling**: `zotero_attachment` verifies and returns local attachment paths. Reading PDF contents depends on host environment capabilities.
- **Export format**: Export tools return plain text (such as BibTeX, RIS, or CSL JSON), which can be copied or downloaded directly from the panel.

## Permissions

- **Network**: HTTP requests are restricted to the local `http://127.0.0.1:23119/api` loopback address. The plugin follows no redirects and makes no outbound network connections.
- **Filesystem and processes**: Read-only access to local attachment paths (verified via async `stat`). The plugin executes no shell commands, loads no native binary modules, and spawns no background daemons.
- **Persistence**: Configuration is stored in `$DSH_HOME/settings.yaml`. If "Always Allow" is selected during write authorization, the issued key is stored in the host credentials store.
- **Lifecycle**: Configuration changes take effect immediately on save. Installing or removing the plugin requires restarting the host application.

## Documentation

| Document                                            | Covers                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| [Getting Started](docs/getting-started.en.md)       | Installation, prerequisites, and connection verification                  |
| [Features](docs/features.en.md)                     | Sources panel, chat integration, evidence extraction, and export workflow |
| [Tool Reference](docs/tools.en.md)                  | Parameters, return values, and error codes for all 11 tools               |
| [Configuration Reference](docs/configuration.en.md) | 36 configuration fields, default values, and hot-reload behavior          |
| [Architecture](docs/architecture.en.md)             | Data flow, layer responsibilities, and design boundaries                  |
| [Development Guide](docs/development.en.md)         | Build, test, local development, and release workflow                      |
| [Scenarios](docs/scenarios.en.md)                   | Real-conversation acceptance cases and everyday usage prompts             |
| [Troubleshooting](docs/troubleshooting.en.md)       | Common issues, diagnostic steps, and fixes                                |

## License

[MIT](./LICENSE)
