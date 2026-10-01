<p align="right"><a href="tools.md"><b>中文</b></a></p>

# Tool Reference

dsh-zotero registers 16 tools (8 read tools and 8 write tools) that interact with your Zotero library through the local HTTP API. The 8 write tools are disabled by default and require enabling `writeEnabled` in configuration, and they operate only on the personal library (`zotero://user/0/`). All item references (refs) are stable identifiers in `zotero://user/0/item/<KEY>` (personal library) or `zotero://group/<ID>/item/<KEY>` (group library) format.

### Interactive Presentation (Toolviews)

In the DSH Web conversation stream, all 16 tools feature structured, read-only cards (`tool.call.toolview`). During execution, the interface renders lifecycle status indicators (preparing, running, success, stopped, error, declined, outcome unreported), collapsible structured views, quick copy actions, and deep links to open items or PDFs in local Zotero.

---

## zotero_search

Search for candidate items in the library. Supports metadata matching and indexed full-text search.

### Parameters

| Parameter        | Type                           | Default             | Description                                                                                                                                                                         |
| ---------------- | ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`          | string                         | —                   | Free-text query; omit to browse all items                                                                                                                                           |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | Search mode: `metadata` matches title/author/year; `everything` also searches indexed full text                                                                                     |
| `scope`          | object                         | `{kind: "library"}` | Search scope: `{kind:"library"}`, `{kind:"collection", refOrName}`, `{kind:"savedSearch", refOrName}`, or `{kind:"publications"}` (`publications` personal library only)            |
| `library`        | object                         | —                   | Target library: `{type:"user", id:0}` or `{type:"group", id}`; sets context when scope specifies a name                                                                             |
| `itemTypes`      | string[]                       | —                   | Zotero item types (e.g. `journalArticle`), combined with OR                                                                                                                         |
| `tags`           | string[]                       | —                   | Tag names, combined according to `tagMatch`                                                                                                                                         |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | Tag matching logic: `all` for AND, `any` for OR (used with `tags`)                                                                                                                  |
| `excludeTags`    | string[]                       | —                   | Tags to exclude (NOT)                                                                                                                                                               |
| `includeTrashed` | boolean                        | `false`             | Whether to include items in the trash (library scope only)                                                                                                                          |
| `itemLevel`      | `"top"` \| `"all"`             | `"top"`             | Item hierarchy: `top` searches top-level items only; `all` includes child items and attachments (library/collection scopes only; publications and saved searches serve one listing) |
| `sort`           | string                         | `"dateModified"`    | Sort field: `dateModified`, `dateAdded`, `date`, `title`, `creator`                                                                                                                 |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | Sort direction                                                                                                                                                                      |
| `offset`         | integer                        | `0`                 | Pagination offset                                                                                                                                                                   |
| `limit`          | integer                        | `10`                | Maximum items returned (capped by `maxSearchResults`, default 20)                                                                                                                   |

### Output

Returns an object containing: `scope`, `items` (including ref, title, creatorSummary, year, itemType, parentRef, bestAttachmentRef, bestAttachmentType, attachmentSize, extra), `total`, `offset`, `returned`, `nextOffset`, and optional `supplemental` (containing note matches `{kind:"noteBody", items, scanned, truncated}`). In card presentations, if `extra` carries Citation Key, it is formatted as `[@citekey]`.

### Notes

On the initial query (offset 0) with a `library` or `collection` scope, note bodies are scanned and matches are returned under `supplemental.items`. `items` and `total` count only primary bibliographic items.

### Example

```text
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

Read structured metadata and child content for a single item.

### Parameters

| Parameter | Type                                        | Required | Description                                                                              |
| --------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `ref`     | string                                      | ✓        | Item reference                                                                           |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —        | Child content types to include                                                           |
| `fields`  | `"standard"` \| `"all"`                     | —        | Field scope: `standard` (default) returns normalized model; `all` includes `extraFields` |

### Output

Returns a detailed item object:

- `ref`, `itemType`, `title`;
- `creators`: list of creator objects (each with `creatorType`, plus optional `name`, `firstName`, `lastName`);
- `extra`: extra metadata (such as Citation Key, arXiv ID, PMID);
- `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`;
- `tags`, `collections`, `children`, `bestAttachment`, `relations`;
- `extraFields` when `fields="all"`;
- Requested child collections: `notes`, `annotations`, `attachments` (each with total, returned, items).

### Example

```text
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

Extract and rank relevant text passages from multiple data sources for a single item using BM25.

### Parameters

| Parameter          | Type     | Default  | Description                                                              |
| ------------------ | -------- | -------- | ------------------------------------------------------------------------ |
| `ref`              | string   | —        | Item reference (required)                                                |
| `query`            | string   | —        | Search query for ranking evidence (required)                             |
| `sources`          | string[] | All 4    | Sources to search: `annotation`, `note`, `abstract`, `fulltext`          |
| `passages`         | integer  | `4`      | Maximum passages returned (capped by `maxEvidencePassages`, default 4)   |
| `attachmentPolicy` | string   | `"best"` | Full-text attachment selection policy: `best`, `allIndexed`, `specified` |
| `attachmentRefs`   | string[] | —        | Target attachment refs when `attachmentPolicy="specified"`               |

### Output

Returns an object containing: `ref`, `attachmentRef`, `attachmentContentType`, `coverage`, `attachments` (status breakdown per attachment), `evidence` (passage list, each with source, sourceRef, attachmentRef, text, chunkIndex, chunkCount, comment, pageLabel, matchedFields), `truncated`, `sourcesSkipped`.

### Notes

- Only `annotation` sources include `pageLabel`; full-text passages do not carry page numbers;
- Unavailable or unindexed sources are logged under `sourcesSkipped`;
- Annotations rank highlight text alongside user comments, with `matchedFields` indicating whether match occurred in `text` or `comment`;
- In multi-attachment policies, unindexed files are marked `unindexed`, and files beyond the attachment limit are marked `unread`.

### Example

```text
zotero_retrieve(ref="zotero://user/0/item/ABC123", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_attachment

Resolve an item or attachment reference to a verified local file path or URL.

### Parameters

| Parameter | Type   | Required | Description                |
| --------- | ------ | -------- | -------------------------- |
| `ref`     | string | ✓        | Item ref or attachment ref |

### Output

Discriminated union:

- Local file: `{kind: "file", path, ref, title, contentType}` (path verified via async `stat`);
- Linked attachment: `{kind: "url", url, ref, title, contentType}`.

### Example

```text
zotero_attachment(ref="zotero://user/0/item/ABC123")
```

---

## zotero_export

Generate formatted citations, bibliographies, or export files.

### Parameters

| Parameter           | Type     | Default      | Description                                                                                  |
| ------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------- |
| `refs`              | string[] | —            | List of item references (required, capped by `maxExportRefs`, default 50)                    |
| `format`            | string   | —            | Export format: `citation`, `bibliography`, `bibtex`, `biblatex`, `ris`, `csljson` (required) |
| `style`             | string   | Config value | CSL style identifier (citation/bibliography only)                                            |
| `locale`            | string   | `"en-US"`    | CSL locale (citation/bibliography only)                                                      |
| `run_in_background` | boolean  | `false`      | Whether to launch as a background Job (managed by Harness `ctx.jobs`)                        |

### Output

When completed in the foreground:

- `citation`: `{citations: [{ref, text}]}`;
- `bibliography`: `{text}`;
- `bibtex` / `biblatex` / `ris` / `csljson`: `{text, items: [{ref, key, title, entryIndex, start, end}]}`.

When run in the background (or automatically promoted upon wait timeout):
Returns `{kind: "background", jobId}` or `{kind: "promoted", jobId, timeoutMs, message}`. Progress reports to the session header and logs; final output is stored in the Job result.

### Notes

- In `citation` mode, requests exceeding 50 keys batch automatically;
- `bibtex`, `biblatex`, `ris`, and `csljson` utilize a zero-N+1 in-memory slicing engine: batch export executes in a single local API call ($O(1)$ HTTP request), where the engine syntax-awarely parses and slices entries in memory matching requested refs, supporting up to 50 items per call;
- All refs in a single export call must belong to the same library.

### Example

```text
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex", run_in_background=true)
```

---

## zotero_browse

Discover library structure and taxonomy metadata with pagination support.

### Parameters

| Parameter       | Type    | Default                 | Description                                                                                                              |
| --------------- | ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kind`          | string  | —                       | Browse category: `libraries`, `collections`, `savedSearches`, `tags`, `itemTypes`, `itemFields` (required)               |
| `library`       | object  | `{type: "user", id: 0}` | Target library (applicable to collections, savedSearches, tags)                                                          |
| `parentRef`     | string  | —                       | `collections` only: parent collection ref; omit to list top-level collections                                            |
| `tagScope`      | string  | `"library"`             | `tags` only: scope, supporting `library`, `collection`, `publications` (`publications` personal library only)            |
| `tagCollection` | string  | —                       | `tags` with `tagScope="collection"`: collection ref or exact name                                                        |
| `itemLevel`     | string  | `"top"`                 | Scoped `tags` only: `top` counts bibliographic items only; `all` includes child items (library/collection scopes only)   |
| `itemQuery`     | string  | —                       | Scoped `tags` only: count tags matching query term                                                                       |
| `itemQueryMode` | string  | `"titleCreatorYear"`    | Scoped `tags` only: item-query mode for `itemQuery`: `titleCreatorYear` or `everything` (defaults to `titleCreatorYear`) |
| `itemType`      | string  | —                       | `itemFields` only: item type to list fields and creator types for                                                        |
| `q`             | string  | —                       | Substring filter for tags                                                                                                |
| `match`         | string  | `"contains"`            | Tag matching method: `contains` or `startsWith`                                                                          |
| `offset`        | integer | `0`                     | Pagination offset                                                                                                        |
| `limit`         | integer | `20`                    | Maximum items returned (capped by `maxBrowseResults`, default 50)                                                        |

### Output

Structured rows per `kind`:

- `libraries`: `{library, name}`
- `collections`: `{ref, name, parentRef?, path, depth}`
- `savedSearches`: `{ref, name, conditions?}`
- `tags`: `{tag, count?}`
- `itemTypes`: `{itemType, localized?}`
- `itemFields`: `{field, localized?}` or `{creatorType, localized?}`

### Example

```text
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_children

List child objects belonging to an item or attachment.

### Parameters

| Parameter | Type     | Required | Description                                                                        |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Item reference or attachment reference                                             |
| `include` | string[] | —        | Child types to include: `notes`, `attachments`, `annotations` (omit for all three) |

### Output

Returns `{ref, itemType?, serverId?, notes?, attachments?, annotations?}`, each with `total`, `returned`, and `items`.

### Example

```text
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

Inspect library modifications and deletions based on local transaction versions.

### Parameters

| Parameter           | Type     | Default                 | Description                                                                     |
| ------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------- |
| `library`           | object   | `{type: "user", id: 0}` | Target library                                                                  |
| `since`             | object   | —                       | Starting cursor `{serverId, library, version}`; omit to get initial baseline    |
| `include`           | string[] | All except fulltext     | Monitored kinds: `items`, `collections`, `savedSearches`, `fulltext`, `deleted` |
| `run_in_background` | boolean  | `false`                 | Whether to launch as a background Job                                           |

### Output

When completed in the foreground:
`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed, deleted?, totals?, unobservable?, truncated?}`.

- `changed`: changed objects categorized by resource type (`items`, `childItems`, `trashedItems`, `collections`, `savedSearches`, `fulltextAttachments`);
- `deleted`: keys or tag names of deleted records;
- `cursor`: returned only when the read range is completely observed and unmodified during the read, safe for subsequent incremental queries;
- `unobservable`: resources that cannot be monitored along with reasons.

### Example

```text
zotero_changes()
zotero_changes(since={serverId: "server1", library: {type: "user", id: 0}, version: 1234}, include=["items", "deleted"])
```

---

## zotero_create_note

Create a standalone research note or a child note under a specific item.

### Supported Markdown Grammar

Input `markdown` is converted into a restricted HTML whitelist natively supported by Zotero 7+ prior to storage (unknown syntax degrades safely to literal text, with no raw HTML passthrough or invented attributes):

- **Paragraphs and Headings**: Blank-line separated paragraphs; soft-wrapped lines join with spaces; ATX headings `#`–`####` (five or more hashes stay literal text);
- **Emphasis and Highlights**: `**bold**`, `*italic*` (underscores `_` stay literal to protect identifier names); `==highlight==` converted to `<mark>`;
- **Math Expressions**: `$$...$$` blocks converted to `<math-display>` and inline `$formula$` converted to `<math-inline>` (native KaTeX rendering; formulas are immune to emphasis corruption; currency amounts like `$100` are protected);
- **Lists and Task Lists**: `-`/`*` bullets and `1.`/`1)` numbers; `- [ ]` unchecked and `- [x]` checked task lists (rendered as native lists with checkbox controls and `task-list` classes, with nesting support);
- **Code**: Inline `` `spans` `` and ``` fenced blocks (escaped verbatim with no formatting inside);
- **Quotes and Tables**: `>` blockquotes; pipe tables with a `---` separator row;
- **Links and Rules**: `[text](url)` (restricted to `https://`, `http://`, and `zotero://` schemes); `---` and `***` horizontal rules.

### Parameters

| Parameter     | Type     | Required | Description                                                                                                                                                            |
| ------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown`    | string   | ✓        | Note body in Markdown (capped by `writeNoteMaxChars`, default 65536)                                                                                                   |
| `parentItem`  | string   | —        | Parent item reference; omit for standalone note                                                                                                                        |
| `collections` | string[] | —        | Target collection refs or names (standalone notes only; child notes inherit parent collections)                                                                        |
| `tags`        | string[] | —        | Tags to attach to the note                                                                                                                                             |
| `sourceRefs`  | string[] | —        | Referenced source item refs, stored as `dc:relation` links (supports personal and group library items; group items map to `http://zotero.org/groups/<id>/items/<key>`) |

### Output

- Success: `{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`;
- Declined by user on plan card: `{kind: "declined"}`;
- Submitted but unverified: `{kind: "committed-unverified", committed: true, retryable: false, reason}`.

### Example

```text
zotero_create_note(markdown="## Methodology\n- Key point 1\n- Key point 2", parentItem="zotero://user/0/item/ABCD1234", tags=["review"])
```

---

## zotero_update_item_tags

Adds and removes tags on an item in a single call. Read-merge-write semantics: `add` and `remove` settle together, existing tags keep their properties (colored/automatic types), and `remove` wins for a saved tag named in both lists.

### Parameters

| Parameter | Type     | Required | Description                                                                |
| --------- | -------- | -------- | -------------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Target item ref (`zotero://user/0/item/<KEY>`)                             |
| `add`     | string[] | —        | Tags to add; they merge with the item's existing tags, duplicates collapse |
| `remove`  | string[] | —        | Tags to remove, matched exactly; unknown names are ignored                 |

`add` and `remove` must carry at least one entry between them (each list capped by `writeListMaxItems`, default 50), otherwise the call is refused.

### Output

- Something actually moved: `{kind: "applied", ref, version, tags, added, removed, unchanged: false, libraryVersion, serverId?}`;
- Nothing would change: `{kind: "applied", ..., unchanged: true}` with no PATCH sent, `version` being the version that was read;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_update_item_tags(ref="zotero://user/0/item/ABCD1234", add=["deep-learning", "to-read"], remove=["stale"])
```

---

## zotero_update_item_collections

Joins and leaves collections for an item in a single call. Collection arguments are `zotero://user/0/collection/<KEY>` refs or exact names (`zotero_browse` lists them); an unresolvable name fails before any write.

### Parameters

| Parameter | Type     | Required | Description                                                            |
| --------- | -------- | -------- | ---------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Target item ref                                                        |
| `add`     | string[] | —        | Collections to join, as refs or exact names                            |
| `remove`  | string[] | —        | Collections to leave, as refs or exact names; unknown ones are ignored |

`add` and `remove` must carry at least one entry between them (capped by `writeListMaxItems`), otherwise the call is refused.

### Output

- Something actually moved: `{kind: "applied", ref, version, collections, added, removed, unchanged: false, libraryVersion, serverId?}`;
- The membership already matched: `{kind: "applied", ..., unchanged: true}` with no PATCH sent;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_update_item_collections(ref="zotero://user/0/item/ABCD1234", add=["Methodology"], remove=["Old collection"])
```

---

## zotero_create_collection

Creates a collection, top-level or under a parent collection.

### Parameters

| Parameter | Type   | Required | Description                                                                                                       |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`    | string | ✓        | The new collection name (non-blank); a sibling with the same name refuses the write                               |
| `parent`  | string | —        | The parent collection: a `zotero://user/0/collection/<KEY>` ref or an exact name; omit for a top-level collection |

### Output

- Created: `{kind: "applied", ref, key, version, name, parentRef?, libraryVersion, serverId?}`;
- Committed but the saved state could not be verified: `{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown", ...}` — **not retryable**; reconcile by key/ref in Zotero;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_create_collection(name="Field notes", parent="Methodology")
```

---

## zotero_delete_collection

Deletes a collection. **Irreversible**: the collection's structure goes away, the items stay in the library, and child collections are deleted with the parent. The plan card states the collection's item and subcollection counts first (shown as `unknown` when those preview reads fail), and the delete carries the library version of its preceding read.

### Parameters

| Parameter    | Type   | Required | Description                                                                         |
| ------------ | ------ | -------- | ----------------------------------------------------------------------------------- |
| `collection` | string | ✓        | The collection to delete: a `zotero://user/0/collection/<KEY>` ref or an exact name |

### Output

- Deleted: `{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_delete_collection(collection="Field notes")
```

---

## zotero_create_item

Creates a bibliographic item from a closed field set. **No BibTeX/CSL-JSON channel exists**: Zotero's `POST /items` only accepts Zotero item JSON, so the entry is assembled field by field and nothing outside the set leaves this module.

### Parameters

| Parameter          | Type     | Required | Description                                                                                                   |
| ------------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `itemType`         | string   | ✓        | Item type: `webpage`, `journalArticle`, `book`, `conferencePaper`, `report`, `thesis`, `document`, `preprint` |
| `title`            | string   | —        | The title; at least a title or a URL is required                                                              |
| `url`              | string   | —        | The URL; at least a title or a URL is required                                                                |
| `date`             | string   | —        | The publication date, as Zotero stores it                                                                     |
| `doi`              | string   | —        | The DOI (stored in the `DOI` field)                                                                           |
| `abstractNote`     | string   | —        | The abstract                                                                                                  |
| `publicationTitle` | string   | —        | The venue (journal, proceedings, site)                                                                        |
| `creators`         | object[] | —        | Each entry carries a `creatorType` and either a `name` or a `firstName`/`lastName` pair                       |

### Output

- Created: `{kind: "applied", ref, key, version, itemType, title?, libraryVersion, serverId?}`;
- Committed but unverified: `{kind: "committed-unverified", committed: true, retryable: false, reason, ...}`, **not retryable**;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_create_item(itemType="journalArticle", title="Attention Is All You Need", date="2017", doi="10.48550/arXiv.1706.03762", creators=[{"creatorType": "author", "name": "Vaswani, Ashish"}])
```

---

## zotero_update_item

Corrects an item's scalar metadata. Field validity comes from Zotero's `itemTypeFields`: a field the item type does not accept is refused before any PATCH, and values must be non-blank text. The write carries the item's version precondition (`If-Unmodified-Since-Version`).

### Parameters

| Parameter | Type   | Required | Description                                                                                 |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `ref`     | string | ✓        | Target item ref (`zotero://user/0/item/<KEY>`)                                              |
| `set`     | object | ✓        | At least one of: `title`, `date`, `url`, `doi`, `abstractNote`, `publicationTitle`, `extra` |

### Output

- Fields actually changed: `{kind: "applied", ref, version, changed, libraryVersion, serverId?}` (`changed` lists the submitted field names, sorted);
- Declined on the plan card: `{kind: "declined"}`;
- Lost precondition: `ZOTERO_WRITE_CONFLICT` — the object changed underneath the read; run the tool once more (the re-run re-reads the version).

### Example

```text
zotero_update_item(ref="zotero://user/0/item/ABCD1234", set={"title": "Attention Is All You Need (2017)", "doi": "10.48550/arXiv.1706.03762"})
```

---

## zotero_delete_library_tags

Deletes tags **library-wide** by name. **Irreversible**: the tags come off every item in the library. The plan card states each tag's item count first (shown as `unknown items` when that preview read fails), the delete carries the library version of its preceding read, and unmatched names are silently ignored so a retry is idempotent.

### Parameters

| Parameter | Type     | Required | Description                                                                       |
| --------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `tags`    | string[] | ✓        | Tag names to delete library-wide (1..`writeListMaxItems`, server cap 50 per call) |

### Output

- Deleted: `{kind: "deleted", deletedTags, libraryVersion, serverId?}` (`deletedTags` is the requested list, sorted by name);
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_delete_library_tags(tags=["stale", "obsolete"])
```

---

## Write Boundaries and Safety

Write tools are disabled by default, require `writeEnabled` in configuration, and operate exclusively on personal libraries (`zotero://user/0/`).

1. **Dual Confirmation**:
   - Session approval policy (`ctx.approval.request`): follows session policy; auto-declines if policy is `never`;
   - Plan review card: presents exact Markdown changes for user approval before writing; unapproved requests return `{kind: "declined"}`.
2. **Local API Authentication**:
   - Write operations require a locally issued Zotero API key;
   - Initial writes prompt Zotero's local authorization dialog (Allow, Always Allow, or Decline);
   - With `writePersistKey` enabled, Always-Allow persistent keys are stored securely in the host credentials manager.
3. **Shell Write Interception**:
   - A pre-execution listener detects shell commands directed at local API write endpoints and escalates them to Harness approval requests, preventing unauthorized direct modifications.

---

## Error Codes

| Error Code                          | Description                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `ZOTERO_NOT_RUNNING`                | Zotero is not running or the local port is unreachable                         |
| `ZOTERO_API_DISABLED`               | Zotero is running but local API is disabled in Advanced Preferences (403)      |
| `ZOTERO_API_VERSION`                | Unsupported local API version                                                  |
| `ZOTERO_NOT_IMPLEMENTED`            | Local API returned 501; endpoint or format is unimplemented in this build      |
| `ZOTERO_SERVER_MISMATCH`            | Reference Server ID does not match the active Zotero instance                  |
| `ZOTERO_NOT_FOUND`                  | Referenced item, collection, or saved search does not exist                    |
| `ZOTERO_RANGE_UNSUPPORTED`          | Server does not retain change history back to requested version (409)          |
| `ZOTERO_NO_ATTACHMENT`              | Item has no attachment of the requested type                                   |
| `ZOTERO_NO_FULLTEXT`                | Attachment has no indexed full text                                            |
| `ZOTERO_FILE_MISSING`               | Local attachment file is missing from disk                                     |
| `ZOTERO_INVALID_REF`                | Reference string violates `zotero://` syntax or targets an unsupported library |
| `ZOTERO_INVALID_ARGUMENT`           | Argument violates domain constraints                                           |
| `ZOTERO_SCOPE_AMBIGUOUS`            | Collection or saved search name matches multiple objects                       |
| `ZOTERO_TIMEOUT`                    | Provider request timed out                                                     |
| `ZOTERO_RESPONSE_TOO_LARGE`         | API response stream exceeded size limit                                        |
| `ZOTERO_OUTPUT_TOO_LARGE`           | Export content exceeded character limit                                        |
| `ZOTERO_CAPABILITY_UNAVAILABLE`     | Selected provider does not declare the required capability                     |
| `ZOTERO_PROVIDER_UNAVAILABLE`       | Configured provider is not registered or method is unimplemented               |
| `ZOTERO_UNEXPECTED`                 | Unexpected response payload or behavior                                        |
| `ZOTERO_WRITE_UNAUTHORIZED`         | Write unauthorized: missing or expired key, or rejected in dialog              |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` | Plan review card failed to initialize interactive session                      |
| `ZOTERO_WRITE_CONFLICT`             | Version precondition conflict (412); object was modified externally            |
| `ZOTERO_WRITE_RATE_LIMITED`         | Zotero authorization endpoint rate limited (429)                               |
