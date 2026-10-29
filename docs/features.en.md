<p align="right"><a href="features.md"><b>中文</b></a></p>

# Features

dsh-zotero connects the Zotero library to DSH. The agent searches, reads, and cites literature in conversation, and can write when needed. You browse the whole library and copy citations in the literature panel. The literature trail gathers the papers, extracted passages, and exports from the session for verification. See the [product model](product-model.en.md) for how the three divide the work.

## Searching and Reading in Conversation

The agent has eight read-only tools. Parameters and error codes are in the [tool reference](tools.en.md).

- `zotero_search` matches title, author, and year by default, and `everything` mode searches the full-text index as well. The scope can be the whole library, My Publications, a collection, or a saved search. The first page also scans note bodies; matching items are listed separately in `supplemental` and do not count toward the pagination total.
- `zotero_browse` reads the collection tree, tag list, and saved searches; the page size is bounded by `maxBrowseResults`, and the response carries the total and paging cursor.
- `zotero_get` returns title, authors, year, journal, DOI, URL, and abstract. Add `include` to load child note bodies, PDF annotations, and the attachment list.
- `zotero_children` reads notes, attachments, and annotations. Annotations need a separate request with `itemType=annotation`.
- `zotero_retrieve` finds passages in annotations, notes, the abstract, and the full-text index and ranks them by BM25 term frequency. Each passage carries its source and a page label; only annotations have page numbers, taken from Zotero. The result marks whether a hit landed in body text or an annotation comment. Full-text coverage is in `coverage`, sources that are unindexed or unreadable go into `sourcesSkipped`, and attachment status is `indexed`, `unindexed`, or `unread`.
- `zotero_attachment` resolves an item or attachment to a local absolute path; linked attachments return the URL.
- `zotero_export` supports six formats. Every format except `citation` takes at most 50 items per call, the request limit of Zotero's `itemKey`; `citation` batches in groups of 50.

  | Format                | Output                                                              |
  | --------------------- | ------------------------------------------------------------------- |
  | `citation`            | HTML citations, one per item, in input order                        |
  | `bibliography`        | A merged bibliography in CSL order                                  |
  | `bibtex` / `biblatex` | BibTeX / BibLaTeX entries, with each entry's citation key available |
  | `ris` / `csljson`     | RIS text / CSL-JSON                                                 |

  Style and language default to `defaultStyle` and `defaultLocale` from configuration and can be overridden with `style` and `locale`.

- `zotero_changes` starts from the local library version and reports additions, modifications, and deletions; the Trash counts as a separate block.

Tool results appear in the conversation as read-only cards. Collapsed, each shows a one-line summary; expanded, it shows items, passages, export text, or a receipt according to the tool type, with copy actions and "Read PDF". A card renders only the output the tool already produced and never calls a tool itself.

## Checking the Literature Trail

The literature trail sits at the top of the conversation and groups the literature the agent found and read in this session by item. The data comes from this session's tool-call snapshots, so switching to it issues no new request.

It records the results of read tools and exports. Writes do not enter the trail; modifications have their own cards and approval records. Results from scholarly retrieval appear only after they are saved into the library.

The criteria of each search sit on the first screen: query, scope (library, My Publications, collection, saved search), mode (metadata or full text), filters (item type, tags, Trash), and the returned count against the total. When the note scan ran, the note hit count gets its own line. Technical refs are folded under "Technical details".

The item inspector has three parts. Overview gives the source and action; passages are grouped by source with page labels and coverage; exports list the citation text this paper produced. The session also has an exports summary page, segmented by format and deduplicated across items. Failed export calls are listed separately under operations and do not count as results.

The status bar at the top shows whether the local Zotero is connected. When offline it offers troubleshooting hints and an in-place refresh.

The built-in DSH "Trail" tab shows how tool calls ran. The literature trail shows only literature-related results.

## Using the Literature Panel

The literature panel lives in the right sidebar, beside the conversation. It appears only when all three of these are on:

- the `dsh-zotero/library` row under "Included components" is enabled;
- the core `webEnabled` is on;
- the component's `rightSidebarEnabled` is on.

The navigation area supports multi-library switching (personal and group libraries), a collection tree expanded on demand, saved searches, "My Publications", and "Trash". Saved searches show Zotero's original conditions.

The item list pages through results and can switch between metadata and full-text search modes, five sort fields and both directions, and filter by item type, tag (all/any), year range, and whether an attachment exists. The PDF badge at the end of a row means the best attachment among the search hits is a PDF; a row without the badge does not mean the item has no file.

The inspector header has type, title, authors, venue, and year. The action row can read the PDF, ask, add to chat, copy citation or BibTeX, open more formats (bibliography, BibLaTeX, RIS, CSL-JSON, copy item info), and copy the Zotero link. Below it, the info table, the collection and tag chips, and the three child sets (notes, attachments, annotations) each page independently.

Copying citations uses the same source as `zotero_export`, with style and language following the configuration defaults. BibTeX can be used in LaTeX directly, and the citation key is emitted with the entry. When copying fails, the reason is shown inline in the action row and is not retried automatically.

Local attachments open in the right reader of the owning conversation; URL attachments open in a new browser tab. A host refusal degrades to an inline hint. The panel belongs to the session of the current tab, so write approvals and plan cards go to that session as well.

The panel issues requests only after it is open and the connection is confirmed. No new requests are issued after it closes. When the probe is offline, the area below the toolbar becomes an offline note, and no request is sent until the connection returns.

Wide screens show three columns side by side (navigation, list, detail); narrow screens switch to segmented navigation. The panel remembers the selected item and current segment per Zotero instance.

The panel searches only the local library. Literature outside it is found by the agent with the scholarly retrieval component and appears in the panel and the trail only after it is saved into the library.

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

Every write passes a capability check, session approval, and a plan review card. Irreversible operations declare their impact on the plan card first. When a commit result is unverified, the status reads "submitted, unconfirmed" and never success. Writes in the panel go the same way as agent writes and differ only in who triggers them; panel writes require the owning conversation to be running.

## Scholarly Retrieval (Optional Component)

Scholarly retrieval is provided by the `dsh-zotero/scholarly` component, shipped with the package but off by default. Enabling that component row is the authorization: once enabled it registers seven tools and allows requests to allowlisted external scholarly indexes. While it is not enabled, those tools do not exist and the host issues no external request.

- Search covers arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP; results are fused and deduplicated by relevance and annotated with whether they are already in the local library.
- It can read open-access full text by DOI, arXiv ID, PMID, or PMCID and locate passages, and it can follow citation networks.
- Citation formats come from DOI registration agencies. When verifying a reference list, the conclusion is one of "verified", "needs manual confirmation", "the registry says it does not exist", or "unable to verify".
- When the user explicitly asks, it saves an external result to the local personal library. Only after saving does the result enter the Zotero library and the literature trail.

External retrieval belongs to the agent entry point; the literature panel issues no external request.

## Capabilities and Tools at a Glance

| Capability                                | Conversation (agent tools)                           | Literature panel (human)                 | Literature trail                                |
| ----------------------------------------- | ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Whole-library browsing and structure      | `zotero_browse`                                      | Collection tree, saved searches, Trash   | Records only the structure the agent read       |
| Search                                    | `zotero_search`                                      | Item-list search and filters             | Records criteria and hits                       |
| Details and notes/attachments/annotations | `zotero_get`, `zotero_children`                      | Item inspection and child sets           | Records the items and passages read             |
| Passages                                  | `zotero_retrieve`                                    | Not offered                              | Records passages and sources                    |
| Locate PDF                                | `zotero_attachment`                                  | Read PDF                                 | Records the location result                     |
| Citations and exports                     | `zotero_export`                                      | Copy citation, BibTeX, and other formats | Records export output                           |
| Writes                                    | Fifteen write tools (optional)                       | Approved writes                          | Not recorded                                    |
| Out-of-library literature                 | Seven scholarly retrieval tools (optional component) | Not offered                              | Appears only after being saved into the library |
