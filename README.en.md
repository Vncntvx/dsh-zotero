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
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2"><img src="https://img.shields.io/badge/dsh-0.2.2--rc.2-blue" alt="dsh version" style="max-width:100%;"></a>
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

The agent searches, reads, and cites the library with tools in conversation; the literature trail checks what it did in this session; the literature panel is yours to browse the whole library.

- **Conversation**
  - Search and browsing: Search by title, author, year, tag, or full text, scoped to the whole library, My Publications, one collection, or one saved search. Read collection trees, tags, and saved searches, and batch-read known refs with a separate result for each one.
  - Passage location: Pull passages from full text, notes, and annotations for a specific question. Every passage names its source, annotations keep their Zotero page numbers, and the result reports full-text coverage and the sources it skipped.
  - Ranking and matches: BM25 lexical ranking by default. Optional local semantic ranking runs six CPU-only embedding tiers and fuses them with BM25 through RRF, with every passage reporting a lexical, semantic, or hybrid match. Up to four query variants are scored separately and each passage keeps its best score; an empty result says whether nothing overlapped or no source was available.
  - Citations and export: Generate in-text citations or a merged bibliography in CSL styles, and export BibTeX, BibLaTeX, RIS, or CSL-JSON. Style and locale follow the configured defaults.
  - Reconciliation and changes: Reconcile DOIs, BibTeX keys, or bibliographic fields against the library and get back refs, citation keys, confidence, and a reviewable field diff. Report additions, modifications, and deletions from the library version, with the Trash counted separately.
  - Research SOPs: Eight phased workflows loaded on demand, with only their names and short descriptions resident in the prompt and each carrying stage budgets and stop conditions. The core component ships four (paper digest, evidence synthesis, manuscript audit, library governance) and the scholarly component adds four (research landscape, citation lineage, publication integrity, literature intake).
- **Literature trail (session header)**
  - Search conditions: Every call lists its query, scope (library, My Publications, collection, saved search), mode (metadata or full text), filters, and hit count, with the total and note hits counted separately.
  - Passage review: Passages and annotations are grouped by item with their source, page number, and coverage; refused or cancelled calls are recorded too.
  - Export summary: Every citation and BibTeX entry from the session is collected across items, split by format, and deduplicated, ready to copy or download; failed exports are listed on their own.
  - Long sessions: History-window truncation leaves early items intact. Long lists page, and switching to the trail reads the existing result.
- **Literature panel (right sidebar)**
  - Browsing and filtering: Switch libraries, expand the collection tree on demand, and open saved searches, My Publications, and the Trash. The item list searches metadata or full text, sorts by several fields, and filters by type, tag, year, and attachment presence.
  - Details and reading: Metadata, collections and tags, and the notes, attachments, and annotations sub-collections page independently. Local PDFs open in the right reading pane, and with `allowUrlPdfRead` enabled the panel also reads URL attachments already in the library.
  - Citations and handoff: Copy a citation, bibliography, or BibTeX entry from the action row, and send selected items into the chat draft. The composer's Zotero button and bibliography deliverables both open the panel.
  - State restoration: Per Zotero instance, the panel remembers the selected item, the active section, and expanded collection branches, along with the scroll position and child pagination.
  - Parsed results: With the document parsing component enabled, an item's action row opens a parsed tab named after the paper (full text, figures, selection actions), and the toolbar's Manage parsed docs page lists every artifact, with state and keyword filters, per-row open or reparse, and page-wide batch discard.
- **Optional capabilities (off by default)**
  - Library writes: Enabling `writeEnabled` registers 15 tools that write only to the personal library, covering notes, tags and collection membership, collections, items, saved searches, Trash restore, library-wide tags, and batch operations. Every write passes a capability check, a session approval, and a plan-review card; a commit that cannot be verified reports "committed but unverified".
  - Scholarly retrieval (`dsh-zotero/scholarly`): Seven tools cover arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP, fuse and deduplicate the results, and mark what the library already holds. They read open-access full text by DOI, arXiv ID, PMID, or PMCID, follow citation networks, fetch authoritative citations from the DOI registry, verify references and retraction status (verified, needs review, registry says none, or unverifiable), and save results into the personal library when you ask for it.
  - Document parsing and semantic ranking (`dsh-zotero/enrichment`): Enabling the document parsing component accepts MinerU document egress for documents you submit yourself, and a parse still needs you to submit one specific Zotero PDF attachment or public PDF URL. Once it succeeds, ordinary reads and scholarly full-text reads reuse the Markdown artifact and keep its figures; the six semantic tiers can be downloaded, verified, and deleted here.

For details on interaction patterns, UI roles, and runtime boundaries, see the [product model](docs/product-model.en.md).

## Install

### Desktop app (Plugin Manager)

In the DeepSeek Harness desktop app, open **Plugins** in the sidebar, click **Add Plugin**, and enter the package identifier:

- Latest version (recommended): `dsh-zotero`
- Specific version: `dsh-zotero@1.0.1`
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

> Note: installing directly from the `main` source branch needs a local `prepare` build plus an `allowBuilds` entry for `dsh-zotero` in the profile's `pnpm-workspace.yaml`; the `#release` branch or the npm package skips that step. Separately, npm, `#release`, and local tarball installs need a one-time approval for the transitive `protobufjs` install script on pnpm 11 — see [Getting Started](docs/getting-started.en.md).

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

The plugin registers 23 local tools (8 read + 15 write) and 7 scholarly retrieval tools. Local write tools are off by default; turn on `writeEnabled` in configuration to enable them. Scholarly tools become available when the `dsh-zotero/scholarly` component is enabled.

### Local read tools (8)

| Tool                      | Purpose                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `zotero_search`           | Search papers by title, author, year, tag, or full text, with collection and tag filters                  |
| `zotero_browse`           | Browse the library structure, including the collection tree, tag list, and saved searches                 |
| `zotero_get`              | Read the metadata detail, abstract, attachments, and note list of a single paper                          |
| `zotero_get_batch`        | Read known paper refs in order and report each result independently                                       |
| `zotero_match_references` | Reconcile DOI, BibTeX, and reference fields against local items                                           |
| `zotero_retrieve`         | Find passages relevant to a question in full text, notes, and annotations (annotations keep page numbers) |
| `zotero_changes`          | Check recent additions, modifications, and deletions in the library                                       |
| `zotero_export`           | Generate formatted citations or a bibliography, or export BibTeX, RIS, or CSL JSON                        |

### Scholarly retrieval tools (7, optional component `dsh-zotero/scholarly`)

| Tool                       | Purpose                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `scholarly_search`         | Search across arXiv, OpenAlex, Crossref, S2, PubMed, Europe PMC, and DBLP with RRF fusion         |
| `scholarly_get`            | Retrieve full bibliographic metadata and open-access PDF links for external papers                |
| `scholarly_citations`      | Follow forward citation and backward reference networks                                           |
| `scholarly_read`           | Open-access PDF reading and passage extraction (supports outline, section, and query modes)       |
| `scholarly_cite`           | Fetch authoritative BibTeX, RIS, or formatted citations directly from DOI registration agencies   |
| `scholarly_verify`         | Verify reference list authenticity, DOI matches, and retraction notices against Crossref          |
| `scholarly_save_to_zotero` | Save externally retrieved papers to the personal Zotero library (write operation, needs approval) |

The fifteen write tools (notes, tags and collection membership, collections, items, saved searches, Trash restore, library-wide tags, and batch operations) are off by default. Once enabled they write only to the personal library, and every write needs approval. See the [tool reference](docs/tools.en.md) for the full contract of all 23 local tools and 7 scholarly tools.

## Documentation

### Usage

| Document                                      | Covers                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Getting started](docs/getting-started.en.md) | Installation, connection verification, and the first task                                                                |
| [Product model](docs/product-model.en.md)     | Two entry points, two UI surfaces, component division, and system boundaries                                             |
| [Features](docs/features.en.md)               | Conversation capabilities, the literature trail, the literature panel, writes, scholarly retrieval, and document parsing |
| [Research SOP skills](docs/skills.en.md)      | Eight on-demand research workflows, batching budgets and evidence boundaries                                             |
| [Troubleshooting](docs/troubleshooting.en.md) | Common issues, diagnostic steps, and remedies                                                                            |

### Maintenance

| Document                                            | Covers                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.en.md)             | Data flow, layer responsibilities, component boundaries, and design boundaries          |
| [Tool reference](docs/tools.en.md)                  | Parameters, return values, and error codes for the 23 local tools and 7 scholarly tools |
| [Configuration reference](docs/configuration.en.md) | Fields, defaults, and hot-reload behavior of each settings namespace                    |
| [Development guide](docs/development.en.md)         | Build, test, debug, and release workflow                                                |

## License

This project is licensed under the [MIT License](./LICENSE).
