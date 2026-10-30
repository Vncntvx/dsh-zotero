<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=18&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Search%2C+read%2C+and+trace+citations+from+local+Zotero.%3B%3E+Audit+every+source+and+passage+in+the+Literature+Trail.%3B%3E+Browse+collections+and+cite+instantly+in+the+Literature+Panel."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&amp;logo=deepseek&amp;logoColor=white" alt="powered by dsh" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2"><img src="https://img.shields.io/badge/dsh-0.2.2--alpha.2-blue" alt="dsh version" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://github.com/hashgraph-online/hol-guard"><img src="https://img.shields.io/badge/HOL%20Guard-passing-00a67e" alt="HOL Guard Scanner"></a>
</p>
</div>

<p align="center">
  <a href="README.md"><b>中文</b></a> · <b>English</b>
</p>

dsh-zotero is a local Zotero plugin for DeepSeek Harness. The agent searches, reads, cites, and (optionally) modifies the library in conversation; you browse the whole library and copy citations in the literature panel; the literature trail gathers the papers, passages, and exports from the session for verification.

All operations interact with Zotero through its local API (`127.0.0.1:23119`). Reads need no API key.

## Features

- **Conversation & Retrieval**
  - Search & reading: Search papers by title, author, year, or full text, and read bibliographic metadata, notes, and local PDF full text.
  - Passage extraction: Locate relevant passages across full text, notes, and annotations for specific research questions, with original page numbers preserved on PDF annotations.
  - Citation & export: Generate in-text citations or bibliographies in specified CSL styles, and export BibTeX, RIS, or CSL-JSON.
  - Writing & extensions (optional): With write access enabled, create notes and update tags or collections (each write requires approval); with the scholarly component enabled, search across seven external indexes and verify references.
- **Literature Trail**
  - Search history: The session header shows query terms, scopes, filter conditions, and hit counts for every tool call on the first screen.
  - Passage review: Review extracted passages and annotations grouped by paper, complete with source tags and page numbers for easy verification.
  - Export collection: Review all citations and BibTeX entries generated in the conversation, deduplicated across items and ready to copy or download.
- **Literature Panel**
  - Library browsing: Browse collection trees, tags, saved searches, and the Trash in the right sidebar, with multi-field filtering.
  - Details & reading: Inspect metadata, notes, and attachment lists, and open local PDFs directly in the reading pane.
  - Citations & handoff: Copy BibTeX entries, CSL citations, or item details directly from the action row, or send selected items into the chat draft with one click.

For details on interaction patterns, UI roles, and runtime boundaries, see the [product model](docs/product-model.en.md).

## Install

### Desktop app (Plugin Manager)

In the DeepSeek Harness desktop app, open **Plugins** in the sidebar, click **Add Plugin**, and enter the package identifier:

- Latest version (recommended): `dsh-zotero`
- Specific version: `dsh-zotero@0.14.1`
- GitHub prebuilt branch: `github:Vncntvx/dsh-zotero#release`

### Command line

```sh
# Install latest from npm (recommended)
dsh plugin --profile <name> add dsh-zotero

# Install a specific version
dsh plugin --profile <name> add dsh-zotero@<version>

# Install from GitHub prebuilt branch
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero#release
```

Start a new session after installation. Open the **dsh-zotero** detail page in the plugin manager; its configuration section carries the full configuration form.

> Note: Installing directly from the `main` source branch needs a local build. pnpm blocks dependency builds by default, so use the `#release` branch to skip build configuration and install directly.

## Prerequisites

1. Zotero 7 or newer desktop app installed (writes require Zotero 10).
2. Enable the local API in Zotero: **Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"**.

## Usage examples

### 1. Research and trace citations in conversation

Ask questions about your research topics directly in chat. The agent automatically retrieves items from your local Zotero library, reads full texts, and extracts passages with original page numbers:

- **Literature search & QA**: Ask the agent about a research direction; the agent searches your local library and synthesizes answers using abstracts and metadata.
  ```text
  Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
  ```
- **Locate original passages**: Ask deeper questions about paper details; the agent extracts relevant passages from local PDF full text and annotations, with original page numbers attached.
  ```text
  Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology", sources: ["annotation", "fulltext"])
  ```
- **Generate formatted citations**: Ask for formatted outputs; the agent generates BibTeX entries or CSL citations in your requested style.
  ```text
  Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234"], format: "bibtex")
  ```

### 2. Verify sources and export in the literature trail

After a conversation, click the **Literature Trail** tab at the top of the session to inspect and verify all references used in that session:

- **Review search criteria**: The overview screen displays every query term, search scope (whole library, collection, or saved search), filter conditions, and hit count invoked during the session.
- **Inspect sources item by item**: Check extracted passages against original page numbers and annotations in the item inspector to ensure every cited point is grounded in the source.
- **Deduplicated export aggregation**: Review all citations and BibTeX entries produced during the session in the Export view, automatically deduplicated across items and ready for one-click copying or downloading.

### 3. Browse, read, and cite in the literature panel

When writing papers or organizing literature independently, use the **Literature Panel** in the right sidebar without going through chat:

- **Independent browsing & filtering**: Browse the collection tree, tag system, saved searches, and Trash, with combined filtering by publication year and item type.
- **Inspect details & read PDFs**: Click any item to inspect metadata and associated notes, or open the local PDF directly in the reading pane.
- **Instant citations & chat handoff**: Click "Copy BibTeX" or "Copy citation" in the action row to paste directly into your manuscript; click "Ask" or "Add to chat" to send selected references into the chat draft for targeted discussions.

## Tools

The plugin provides eight read tools and fifteen write tools. Write tools are off by default; turn on `writeEnabled` in configuration to enable them.

| Tool                | Purpose                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `zotero_search`     | Search papers by title, author, year, tag, or full text, with collection and tag filters                           |
| `zotero_browse`     | Browse the library structure, including the collection tree, tag list, and saved searches                          |
| `zotero_get`        | Read the metadata detail, abstract, attachments, and note list of a single paper                                   |
| `zotero_children`   | View the child items associated with a paper, including standalone notes, PDF attachments, and reading annotations |
| `zotero_retrieve`   | Find passages relevant to a question in full text, notes, and annotations (annotations keep page numbers)          |
| `zotero_changes`    | Check recent additions, modifications, and deletions in the library                                                |
| `zotero_attachment` | Get the local PDF file path associated with a paper                                                                |
| `zotero_export`     | Generate formatted citations or a bibliography, or export BibTeX, RIS, or CSL JSON                                 |

The fifteen write tools (notes, tags and collection membership, collections, items, saved searches, Trash restore, library-wide tags, and batch operations) are off by default. Once enabled they write only to the personal library, and every write needs approval. See the [tool reference](docs/tools.en.md) for the full contract of all 23 tools.

## Documentation

### Usage

| Document                                      | Covers                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Getting started](docs/getting-started.en.md) | Installation, connection verification, and the first task                                              |
| [Product model](docs/product-model.en.md)     | Two entry points, two UI surfaces, component division, and system boundaries                           |
| [Features](docs/features.en.md)               | Conversation capabilities, the literature trail, the literature panel, writes, and scholarly retrieval |
| [Troubleshooting](docs/troubleshooting.en.md) | Common issues, diagnostic steps, and remedies                                                          |

### Maintenance

| Document                                            | Covers                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.en.md)             | Data flow, layer responsibilities, component boundaries, and design boundaries          |
| [Tool reference](docs/tools.en.md)                  | Parameters, return values, and error codes for the 23 local tools and 7 scholarly tools |
| [Configuration reference](docs/configuration.en.md) | Fields, defaults, and hot-reload behavior of each settings namespace                    |
| [Development guide](docs/development.en.md)         | Build, test, debug, and release workflow                                                |

## License

This project is licensed under the [MIT License](./LICENSE).
