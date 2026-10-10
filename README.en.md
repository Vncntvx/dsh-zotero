<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=18&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Search%2C+read%2C+and+cite+papers+from+local+Zotero."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2"><img src="https://img.shields.io/badge/dsh-0.2.1--alpha.2-blue" alt="dsh version" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.md"><b>中文</b></a> · <b>English</b>
</p>

dsh-zotero is a local Zotero plugin for DeepSeek Harness. It allows chat agents to search your library, read PDF full text and notes, extract relevant passages, and generate academic citations.

All operations interact with the local Zotero API (`127.0.0.1:23119`); reads need no API key.

## Features

- **Library search and discovery**: Search papers by title, author, year, tags, or full text, with support for collection scopes and recently added items.
- **PDF full text and note reading**: Agents can read structured bibliographic metadata, abstracts, personal notes, and parse local PDF attachments directly.
- **Passage retrieval**: Query papers to locate relevant passages across full text, notes, and annotations; PDF annotations retain original page numbers for direct verification.
- **Citation formatting and export**: Generate formatted citations or export selected items as BibTeX, RIS, or CSL JSON for copying or downloading.
- **Dedicated conversation tab**: Papers referenced in chat automatically sync to the "Zotero" tab at the top of the session, where you can inspect item details, review passages, or open local PDFs.
- **Two-way notes and organization**: Allow the agent to draft reading notes, add tags, and organize collections, with plan review and interactive approval for every write operation.

## Install

From npm (recommended):

```sh
dsh plugin --profile <name> add dsh-zotero
```

From GitHub prebuilt branch:

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero#release
```

After installation, start a new session to use Zotero tools. The plugin provides a configuration page under **Settings → Zotero** to adjust API address, concurrency limits, and retrieval parameters.

> Note: Installing directly from the main source branch requires local compilation. Because pnpm blocks dependency builds by default, use the `#release` branch to skip local build setup.

## Prerequisites

1. Zotero 7 or newer desktop app (writes require Zotero 10).
2. Enable local API in Zotero: **Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"**.

## Usage example

The agent calls tools during conversation, and referenced papers update the Sources panel in real time:

```text
User: Find papers about Risk
Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
       5 matches; items populate the session's Zotero tab

User: What does the first one's abstract say?
Agent → zotero_get(ref: "zotero://user/0/item/ABCD1234")
       Returns metadata and full abstract

User: Find the methodology discussion in this paper
Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology",
                        sources: ["annotation", "fulltext"])
       Returns ranked passages with source tags (annotations include page numbers)

User: Export all three as BibTeX
Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234",
                             "zotero://user/0/item/EFGH5678",
                             "zotero://user/0/item/IJKL9012"], format: "bibtex")
       Generates BibTeX entries; copy or download directly in the UI
```

## Tools

The plugin includes 8 read tools and 8 write tools. Write tools are disabled by default until `writeEnabled` is turned on in settings.

| Tool                | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `zotero_search`     | Search by title, author, year, or full text across libraries, collections, and tags       |
| `zotero_browse`     | Browse library hierarchy: collections tree, saved searches, and tags                      |
| `zotero_get`        | Read structured metadata for an item, including abstract, notes, and attachment list      |
| `zotero_children`   | List child items, including standalone notes, PDF attachments, and annotations            |
| `zotero_retrieve`   | Query passages across full text, notes, and annotations (annotations retain page numbers) |
| `zotero_changes`    | Check recently added, modified, or deleted items in the library                           |
| `zotero_attachment` | Resolve an item to its local PDF file path                                                |
| `zotero_export`     | Generate formatted citations or export BibTeX, RIS, and CSL JSON                          |

See [Tool reference](docs/tools.en.md) for complete parameter definitions of all 16 tools.

## Security and privacy

- Local requests: The plugin sends HTTP requests only to the local Zotero API (`http://127.0.0.1:23119/api`), without depending on Zotero cloud servers.
- Filesystem access: The plugin only checks the existence of local attachment files, executing no shell commands and running no background daemons.
- Write safety: Write tools are disabled by default. When enabled, any changes to your library present an approval card in the interface and require user confirmation before executing.

## Documentation

| Document                                            | Covers                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](docs/getting-started.en.md)       | Installation, prerequisites, and connection verification      |
| [Features](docs/features.en.md)                     | Sources panel, chat integration, and export workflows         |
| [Tool reference](docs/tools.en.md)                  | Parameters, return values, and error codes for all 16 tools   |
| [Configuration reference](docs/configuration.en.md) | 35 configuration fields and default values                    |
| [Architecture](docs/architecture.en.md)             | Data flow, layer responsibilities, and design boundaries      |
| [Development guide](docs/development.en.md)         | Build, test, local development, and release workflow          |
| [Scenarios](docs/scenarios.en.md)                   | Real-conversation acceptance cases and everyday usage prompts |
| [Troubleshooting](docs/troubleshooting.en.md)       | Common issues, diagnostic steps, and fixes                    |

## License

[MIT](./LICENSE)
