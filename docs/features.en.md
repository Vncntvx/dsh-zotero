<p align="right"><a href="features.md"><b>中文</b></a></p>

# Features

dsh-zotero connects the Zotero library to DSH. The agent searches, reads, and cites literature in conversation, and can write when needed. You browse the whole library and copy citations in the literature panel. The literature trail gathers the papers, extracted passages, and exports from the session for review. See the [product model](product-model.en.md) for how the three divide the work.

## Searching and Reading in Conversation

The agent has eight read-only tools. Parameters and error codes are in the [tool reference](tools.en.md).

- `zotero_search` matches title, author, and year by default, and `everything` mode searches the full-text index as well. The scope can be the whole library, My Publications, a collection, or a saved search. The first page also scans note bodies; matching items are listed separately in `supplemental` and do not count toward the pagination total.
- `zotero_browse` reads the collection tree, tag list, and saved searches; the page size is bounded by `maxBrowseResults`, and the response carries the total and paging cursor.
- `zotero_get` returns title, authors, year, journal, DOI, URL, abstract, and a separate `citationKey`; citekey-source conflicts are explicit. Add `include` to load child note bodies, PDF annotations, and the attachment list.
- `zotero_get_batch` reads up to 50 known refs in input order and reports each result independently; use `zotero_get` for one ref.
- `zotero_match_references` reconciles DOI, BibTeX keys, and reference fingerprints with the local library, returning refs, citekeys, confidence, and reviewable field differences; citekey conflicts are explicitly flagged.
- `zotero_retrieve` finds passages in annotations, notes, the abstract, and the full-text index and ranks them by BM25 term frequency. Each passage carries its source and a page label; only annotations have page numbers, taken from Zotero. The result marks whether a hit landed in body text or an annotation comment. Full-text coverage is in `coverage`, sources that are unindexed or unreadable go into `sourcesSkipped`, and attachment status is `indexed`, `unindexed`, or `unread`. Whole-document reading uses `mode="fulltext"`: source-order character windows by default, with `complete=true` reading the whole bounded document in one call and returning the complete text or a whole-document spill handle.
- `zotero_export` supports six formats. Every format except `citation` takes at most 50 items per call, the request limit of Zotero's `itemKey`; `citation` batches in groups of 50.

  | Format                | Output                                                              |
  | --------------------- | ------------------------------------------------------------------- |
  | `citation`            | HTML citations, one per item, in input order                        |
  | `bibliography`        | A merged bibliography in CSL order                                  |
  | `bibtex` / `biblatex` | BibTeX / BibLaTeX entries, with each entry's citation key available |
  | `ris` / `csljson`     | RIS text / CSL-JSON                                                 |

  Style and language default to `defaultStyle` and `defaultLocale` from configuration and can be overridden with `style` and `locale`.

- `zotero_changes` starts from the local library version and reports additions, modifications, and deletions; the Trash counts as a separate block.

Tool results appear as read-only cards in the conversation: collapsed cards show a one-line summary, while expanded cards show items, passages, export text, or a receipt according to the tool type, with copy actions and "Read PDF".

Research SOP skills add eight on-demand workflows: paper digest, research landscape, citation lineage, evidence synthesis, manuscript reference audit, library governance, publication integrity and literature intake. The model selects one from a short catalog of names and descriptions, then loads its full phased instructions with the `skill` tool; bodies stay out of the standing system prompt. See the [research SOP skill reference](skills.en.md).

## Checking the Literature Trail

The literature trail sits at the top of the conversation and groups the literature the agent found and read in this session by item. The data comes from a host session projection folded over the whole session log, so a long session preserves early items; when the projection is unavailable it falls back to the tool-call snapshot of the currently loaded window.

The literature trail records the results of read tools and exports. Write operations are recorded on approval cards, and scholarly retrieval results appear after being saved to the library.

The criteria of each search sit on the first screen: query, scope (library, My Publications, collection, saved search), mode (metadata or full text), filters (item type, tags, Trash), and the returned count against the total. When the note scan ran, the note hit count gets its own line. The technical ref identifier is displayed directly at the bottom of the audit panel with one-click copy support.

The item inspector has three parts. Overview gives the source and action; passages are grouped by source with page labels and coverage; exports list the citation text this paper produced. The session also has an exports summary page, segmented by format and deduplicated across items. Failed export calls are listed in operations.

The status bar at the top shows whether the local Zotero is connected. When offline it offers troubleshooting hints and an in-place refresh. When the session lacks access to `zotero/status`, the status bar displays a permission notice; local items in the trail remain readable.

DSH's built-in "Trail" tab tracks tool-call execution, while the literature trail focuses specifically on literature-related searches, passages, and exports.

## Using the Literature Panel

The literature panel appears in the right sidebar when both of these are on:

- the `dsh-zotero/library` row under "Included components" is enabled;
- the component's `rightSidebarEnabled` is on.

`webEnabled` governs the literature trail at the top of the conversation; `rightSidebarEnabled` controls the literature panel.

The navigation area supports multi-library switching (personal and group libraries), a collection tree expanded on demand, saved searches, "My Publications", and "Trash". Saved searches show Zotero's original conditions. Each collection row ends with the number of items Zotero counts directly in it; an unreported count shows nothing. The toolbar offers a standing "Manage parsed docs" button right after the library selector, including in narrow layouts. It opens a session-scoped manager that names each row with the paper title captured at parse time and shows its attachment or source, parse time, size, and counts. Users can narrow the list by state or keyword, open or reparse a row, and discard the loaded rows in bulk; deletion sends one request per row and keeps failed rows selected. The list loads incrementally through "show more"; a hairline separates adjacent rows, the filter band owns its own top spacing and its own rule, and in a narrow pane the metadata yields while the three row actions stay on one line. The enrichment component must be served to expose the button and page. The PDF URL parse entry lives in the manager.

The manager shows how many parsed documents are available for full-text search and flags unreadable documents or stale entries. The icon beside the search status rebuilds the index from local Markdown. The manager shows progress and lets users cancel, with a brief notification when the operation finishes.

“Batch parse PDFs” can find PDFs in a personal or group library by bibliographic title, author, or publication. The list uses the Zotero parent item for the title, authors, publication, and year when available. Select across pages or select the whole library and exclude individual attachments. Review the library, count, and what goes to MinerU before submitting. Valid existing results are reused. The host processes one PDF at a time. The manager shows progress while the batch is active. Open the dialog to see the current document and failure details or to cancel remaining work. The PDF listing requires a stable instance identifier from the Zotero Local API, available since Zotero 10.

The item list pages through results and can switch between metadata and full-text search modes, five sort fields and both directions, and filter by item type, tag (all/any), year range, and whether an attachment exists. After the year, each row names its item type, its venue, and its authors: the type label follows the panel's own language, with Zotero's localized name standing in for a custom type the panel does not know, and the authors come from the structured creator list rather than the summary string Zotero builds. The current row is marked by a filled background and a 2px primary rail, so it stays recognizable after the pointer leaves or the list scrolls. A PDF badge at the end of a row marks items whose best attachment is a PDF.

In narrow lists, the journal or venue keeps its width and the authors take the space that remains. Right-click a row and choose “Add to chat” to add references one at a time to the current conversation draft. Each item appears as a removable DSH quote capsule carrying bibliographic metadata and its Zotero item reference.

The inspector header has type, title, authors, venue, and year. The action row can read the PDF, ask, copy citation or BibTeX, open more formats (bibliography, BibLaTeX, RIS, CSL-JSON, copy item info), and copy the Zotero link. The abstract sets as body prose: beyond six lines it narrows to a six-line window with its own expand/collapse control under the text, and a paragraph that already fits shows no control. The abstract and standalone note body appear when available, followed by attachments, the Information table, collections, tags, notes, and annotations. Attachments, notes, and annotations page independently. A thin line separates adjacent blocks, and headings align with their body text.

Once you enable journal metrics and save your EasyScholar key, metrics appear for journal articles on the current page as each lookup completes. Library settings offer separate ordered candidates for international indexes and Chinese core journals. The list uses the returned metrics to pick a preset and follows the setting for journals covered by both. The list shows up to three metrics, or two in compact mode. A metrics line appears only when the journal has metrics. The Information table shows the JCR quartile, impact factor, and CAS upgraded quartile by default. After saving new display fields, the panel reads them from available results and looks up journals in view that still lack results. **Refresh all cached journals** updates every saved journal for the active key and reports how many were refreshed. Credential and quota problems raise a toast. Actual errors show their cause in Information, with a retry action at the end of the row when applicable. Previously saved metrics remain available.

Copying citations uses the same source as `zotero_export`, with style and language following the configuration defaults. BibTeX can be used in LaTeX directly, and the citation key is emitted with the entry. When copying fails, the reason is shown inline in the action row.

Local attachments open in the right reader of the owning conversation; URL attachments open in a new browser tab. A host refusal degrades to an inline hint. The panel belongs to the session of the current tab, so write approvals and plan cards go to that session as well.

The panel loads data once the connection is confirmed. When offline, the area below the toolbar displays troubleshooting guidance until the connection is restored.

Wide screens show two columns (navigation, list) until an item is selected, which opens the detail column beside them; narrow screens switch to segmented navigation. The panel remembers the selected item and current segment per Zotero instance.

The panel is dedicated to browsing and searching the local library. External literature is queried by the agent via scholarly retrieval and appears in the panel and trail once saved to the library.

## Writing to the Library (Optional)

Write tools are off by default. Turning on `writeEnabled` in settings registers fifteen tools that write only to the personal library (`zotero://user/0/`):

| Category            | Tools                                                                                    | Notes                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Notes               | `zotero_create_note`, `zotero_update_note`                                               | Create standalone notes or child notes, with tags, collections, and `dc:relation`; updates replace the body under a version precondition |
| Tags and membership | `zotero_update_item_tags`, `zotero_update_item_collections`                              | Read, merge, and write back within one call, preserving existing tag types; name resolution fails before any write                       |
| Collections         | `zotero_create_collection`, `zotero_update_collection`, `zotero_delete_collection`       | Same-name siblings are refused; deletion is irreversible, and the plan card states the item and child-collection counts first            |
| Items               | `zotero_create_item`, `zotero_update_item`, `zotero_restore_items`                       | Create items, correct scalar metadata, restore from the Trash                                                                            |
| Saved searches      | `zotero_create_saved_search`, `zotero_update_saved_search`, `zotero_delete_saved_search` | Manage saved-search definitions                                                                                                          |
| Library-wide tags   | `zotero_delete_library_tags`                                                             | Delete tags library-wide by name (irreversible); unmatched names are ignored, so a retry is idempotent                                   |
| Batch               | `zotero_batch_items`                                                                     | Create, retag, recollect, or trash items in one call, merged under one plan card                                                         |

Every write passes a capability check, session approval, and a plan review card. Irreversible operations declare their impact on the plan card first. When a commit result is unverified, the status reads "submitted, unconfirmed". Writes in the panel go the same way as agent writes and differ only in who triggers them; panel writes require the owning conversation to be running.

## Scholarly Retrieval (Optional Component)

Scholarly retrieval is provided by the `dsh-zotero/scholarly` component, shipped with the package and off by default. Enabling it registers seven external tools: index searches query allowlisted academic platforms, and open-access PDF retrieval accesses public HTTP(S) hosts (with support for local proxy fake-IP mappings, while plain HTTP requires a verified public address). While the component is enabled, the client displays an outbound notice listing the destination hosts; it discloses again after observing the component off and back on.

- Search covers arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP. Results are fused by relevance when they share a DOI, PMID, PMCID, or arXiv ID, or when their title tokens, first author, and publication year match. Preprint and published variants retain their own metadata, and each result is annotated with its local-library status.
- It can read open-access full text by DOI, arXiv ID, PMID, or PMCID and locate passages, and it can follow citation networks.
- Citation formats come from DOI registration agencies; each returned value is parsed against the requested format and checked for the matching DOI first. Reference verification returns one of "verified", "needs manual confirmation", "the registry says it does not exist", or "unable to verify". A bare DOI checks the identifier and retraction state; supplied bibliographic fields are compared when present.
- When the user explicitly asks, it saves an external result to the local personal library. Only after saving does the result enter the Zotero library and the literature trail.

External retrieval runs through agent tool calls. The literature panel supports downloading PDFs from existing URL attachments when `allowUrlPdfRead` is enabled.

## Document Enrichment (Optional Component)

Document parsing is provided by the `dsh-zotero/enrichment` component, shipped with the package and off by default. The component supports user-submitted PDF parsing, read-only reuse of existing Markdown artifacts, and local semantic ranking with model management. Users can submit a specific Zotero PDF attachment or public PDF URL from the literature panel; the client displays an egress disclosure while the component is enabled; it discloses again after observing the component off and back on.

- `free` uses the lightweight API (≤10 MB, ≤20 pages, token-free); `pro` uses the precise API (≤200 MB, ≤200 pages, requires a token). Mode selection and token configuration are independent. Failed parses return an explicit error.
- `zotero_retrieve` and `scholarly_read` query valid Markdown through the core's read-only `FulltextEnhancer.lookup` (by source) and `lookupArtifact` (by artifact id) and prioritize it; cache misses or modified source files fall back to Zotero `/fulltext` and scholarly local extraction, respectively.
- Parsed Markdown is stored in `<outputDir>/<sha256>/`, with the figures it references kept under that directory's `images/` under their original names. Local attachments are cached by size, timestamp, and content fingerprint; URL sources are validated via HEAD requests matching ETag or Last-Modified. Source-index hits reuse existing artifacts directly.
- When a valid artifact exists, "Parse this PDF" becomes "Read Markdown". Clicking it opens a right-sidebar result tab named after the paper, shows preparation progress, and presents the complete Markdown and all artifact figures with copy and download actions. A failed refresh keeps the previous complete result. For items with several PDFs, "Read PDF" and parsing share a chooser that labels each attachment: existing artifacts open in their result tab, while the others submit that attachment for parsing. Selecting a passage opens a small menu: "Explain" writes the passage, the paper metadata, and the item ref into the current session draft and asks the model to read the complete parsed document once (through its spill handle when one exists), then explain the passage in the interface language in clearly separated blocks, verifying quotations and reference details first; "Copy selection" puts it on the clipboard.
- The output directory accepts an absolute path or `~/`; relative paths are rejected at save time, and unavailable directories fail with `ZOTERO_ENRICHMENT_OUTPUT_INVALID`.
- Optional local semantic ranking provides semantic tiers decoupled from physical model versions (`balanced` general & balanced · backed by Qwen3-0.6B, `lightweight` ultra-lightweight · backed by Granite-97M, `bilingual` Chinese-English · backed by KaLM-0.5B, `english` English long-context · backed by Nomic-137M, `hybrid` multi-vector hybrid · backed by BGE-M3, `academic` classic academic · backed by GTE-Base). Tier configurations stay valid across model updates. The WASM inference runtime ships inside the plugin, and models are downloaded in settings (via HF-Mirror or Hugging Face); both run on 16GB RAM CPU-only machines. When disabled, ranking uses BM25; when enabled but the model is unavailable, queries return `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` with a download prompt. Across 20 authored paraphrase regression cases, actual-vector recall@4 is 55–95% across tiers (English uses ten English cases). The development guide records the complete data and scope. The settings UI indicates when semantic search lacks a model or precision mode lacks a token.

## Capabilities and Tools at a Glance

| Capability                                | Conversation (agent tools)                           | Literature panel (human)                  | Literature trail                                |
| ----------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Whole-library browsing and structure      | `zotero_browse`                                      | Collection tree, saved searches, Trash    | Records only the structure the agent read       |
| Search                                    | `zotero_search`                                      | Item-list search and filters              | Records criteria and hits                       |
| Details and notes/attachments/annotations | `zotero_get`                                         | Item inspection and child sets            | Records the items and passages read             |
| Passages                                  | `zotero_retrieve`                                    | Not offered                               | Records passages and sources                    |
| Higher-quality full text (optional)       | `zotero_retrieve` / `scholarly_read` use parsed text | Parsed result tab (ask about a selection) | Records the read                                |
| Locate PDF                                | `zotero_get` (`locations="best"`)                    | Read PDF                                  | Records the location result                     |
| Citations and exports                     | `zotero_export`                                      | Copy citation, BibTeX, and other formats  | Records export output                           |
| Writes                                    | Fifteen write tools (optional)                       | Approved writes                           | Not recorded                                    |
| Out-of-library literature                 | Seven scholarly retrieval tools (optional component) | Not offered                               | Appears only after being saved into the library |

## Collection navigation and state restoration

The literature panel collection directory loads incrementally by level, with each branch expanding and retrying independently, while item lists use standard pagination. Expanding nodes with sub-collections allows navigation through deeper categories. When the panel is reopened, previously expanded branches and loading states are restored automatically, with the current collection name and hierarchy re-resolved. Selecting a different collection or updating filter criteria refreshes the list immediately to match the active scope.
