<p align="right"><a href="tools.md"><b>中文</b></a></p>

# Tool Reference

dsh-zotero registers 23 local tools (8 read tools and 15 write tools) that work with the Zotero library through the local Zotero HTTP API. The 15 write tools are off by default and need `writeEnabled` turned on in configuration, and they operate only on the personal library (`zotero://user/0/`). Another 7 scholarly retrieval tools belong to the separate `dsh-zotero/scholarly` component, which ships with the package and is off by default; enabling that component enables those tools. Every item reference (ref) is a stable identifier in `zotero://user/0/item/<KEY>` (personal library) or `zotero://group/<ID>/item/<KEY>` (group library) form.

---

## zotero_search

Search for items in the library. Supports metadata matching and full-text search.

### Parameters

| Parameter        | Type                           | Default             | Description                                                                                                                                                                             |
| ---------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`          | string                         | none                | Free-text query; omit it to browse all items                                                                                                                                            |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | Search mode: `metadata` matches title/author/year; `everything` also searches the full-text index                                                                                       |
| `scope`          | object                         | `{kind: "library"}` | Search scope: `{kind:"library"}`, `{kind:"collection", refOrName}`, `{kind:"savedSearch", refOrName}`, or `{kind:"publications"}` (`publications` is personal library only)             |
| `library`        | object                         | none                | Target library: `{type:"user", id:0}` or `{type:"group", id}`; sets the context when `scope` is given a name                                                                            |
| `itemTypes`      | string[]                       | none                | Zotero item types (such as `journalArticle`), combined with OR                                                                                                                          |
| `tags`           | string[]                       | none                | Tag list; `tagMatch` decides how they combine                                                                                                                                           |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | Multi-tag matching: `all` is AND, `any` is OR (used with `tags`)                                                                                                                        |
| `excludeTags`    | string[]                       | none                | Tags to exclude (NOT)                                                                                                                                                                   |
| `includeTrashed` | boolean                        | `false`             | Whether to include items in the trash (`library` scope only)                                                                                                                            |
| `itemLevel`      | `"top"` \| `"all"`             | `"top"`             | Item level: `top` searches top-level items only; `all` also searches child items and attachments (`library`/`collection` scopes only; `publications` and saved searches serve one list) |
| `sort`           | string                         | `"dateModified"`    | Sort field: `dateModified`, `dateAdded`, `date`, `title`, `creator`                                                                                                                     |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | Sort direction                                                                                                                                                                          |
| `offset`         | integer                        | `0`                 | Pagination offset                                                                                                                                                                       |
| `limit`          | integer                        | `10`                | Item cap (bounded by `maxSearchResults`, default 20)                                                                                                                                    |

### Output

The returned object contains `scope`, `items` (with ref, title, creatorSummary, year, itemType, parentRef, bestAttachmentRef, bestAttachmentType, attachmentSize, extra, doi), `total`, `offset`, `returned`, `nextOffset`, and an optional `supplemental` (with note hits `{kind:"noteBody", items, scanned, truncated}`). In the card presentation, when `extra` carries a Citation Key (case-insensitive, including the `citekey` alias, sharing one grammar with export alignment and taking the first token after the colon), it is shown as `[@citekey]`.

### Notes

On the initial query (offset 0) with a `library`, `publications`, or `collection` scope, the plugin scans note bodies and lists matching items in `supplemental.items`. `items` and `total` count primary result items only.

### Example

```text
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

Read the detailed metadata and related child content of a single paper.

### Parameters

| Parameter | Type                                        | Required | Description                                                                                    |
| --------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `ref`     | string                                      | ✓        | Item ref                                                                                       |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | none     | Child content types to include                                                                 |
| `fields`  | `"standard"` \| `"all"`                     | none     | Field scope: `standard` (default) returns the normalized field model; `all` adds `extraFields` |

### Output

Returns a detailed item object:

- `ref`, `itemType`, `title`;
- `creators`: list of creator objects (each with `creatorType`, plus optional `name`, `firstName`, `lastName`);
- `extra`: extra metadata (such as Citation Key, arXiv ID, PMID);
- `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`;
- `tags`, `collections`, `children`, `bestAttachment`, `relations`;
- the native extra fields `extraFields` when `fields="all"`;
- the requested child sets: `notes`, `annotations`, `attachments` (each with total, returned, items).

### Example

```text
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

Extract query-relevant passages from a single paper's multiple sources and rank them with BM25.

### Parameters

| Parameter          | Type     | Default  | Description                                                     |
| ------------------ | -------- | -------- | --------------------------------------------------------------- |
| `ref`              | string   | none     | Item ref (required)                                             |
| `query`            | string   | none     | Ranking keywords (required)                                     |
| `sources`          | string[] | all 4    | Retrieval sources: `annotation`, `note`, `abstract`, `fulltext` |
| `passages`         | integer  | `4`      | Passage cap (bounded by `maxEvidencePassages`, default 4)       |
| `attachmentPolicy` | string   | `"best"` | Full-text attachment policy: `best`, `allIndexed`, `specified`  |
| `attachmentRefs`   | string[] | none     | Attachment refs when `attachmentPolicy="specified"`             |

### Output

The returned structure contains `ref`, `attachmentRef`, `attachmentContentType`, `coverage` (full-text coverage), `attachments` (retrieval status per attachment), `evidence` (passage list, each with source, sourceRef, attachmentRef, text, chunkIndex, chunkCount, comment, pageLabel, matchedFields), `truncated`, and `sourcesSkipped`.

### Notes

- Only `annotation` sources carry a page label (`pageLabel`); full-text passages give no page numbers;
- Unavailable or unindexed sources are recorded in `sourcesSkipped`;
- Annotation content ranks the highlighted text and the user comment together, and `matchedFields` marks whether the match came from `text` or `comment`;
- Under the multi-attachment policies, unindexed attachments are marked `unindexed` and attachments that were not read are marked `unread`.

### Example

```text
zotero_retrieve(ref="zotero://user/0/item/ABC123", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_attachment

Resolve an item or attachment ref to a local file path or link URL.

### Parameters

| Parameter | Type   | Required | Description                |
| --------- | ------ | -------- | -------------------------- |
| `ref`     | string | ✓        | Item ref or attachment ref |

### Output

A union result:

- Local file: `{kind: "file", path, ref, title, contentType}` (the path is verified to exist with an async `stat`);
- Linked attachment: `{kind: "url", url, ref, title, contentType}`.

### Example

```text
zotero_attachment(ref="zotero://user/0/item/ABC123")
```

---

## zotero_export

Generate formatted citations or export data files.

### Parameters

| Parameter           | Type     | Default      | Description                                                                                                                                                                                                                       |
| ------------------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs`              | string[] | none         | Item ref list (required; one call is bounded by `maxExportRefs`, default 50)                                                                                                                                                      |
| `format`            | string   | none         | Export format: `citation`, `bibliography`, `bibtex`, `biblatex`, `ris`, `csljson` (required)                                                                                                                                      |
| `style`             | string   | config value | CSL style identifier (citation and bibliography only)                                                                                                                                                                             |
| `locale`            | string   | `"en-US"`    | CSL locale (citation and bibliography only)                                                                                                                                                                                       |
| `run_in_background` | boolean  | `false`      | Whether to start as a background job (managed by the Harness `ctx.jobs`; the parameter is always declared, and passing `true` while `enableRunInBackground=false` or with no `jobs` service mounted returns a structured refusal) |

### Output

When the foreground call finishes synchronously:

- `citation`: `{citations: [{ref, text}]}`;
- `bibliography`: `{text}`;
- `bibtex` / `biblatex` / `ris` / `csljson`: `{text, items: [{ref, key, title, entryIndex, start, end}]}`.

When it runs in the background (or is promoted automatically after the foreground wait times out):
Returns `{kind: "background", jobId}` or `{kind: "promoted", jobId, timeoutMs, message}`. Job progress shows in the Web session header and the logs, and the result is written to the job artifact when done.

### Notes

- The ref count is first blocked by `maxExportRefs` (default 50). The five formats other than `citation` (`bibliography`, `bibtex`, `biblatex`, `ris`, `csljson`) take at most 50 items per call, which is the cap on Zotero `itemKey` requests; going over is an error, and no automatic batching happens;
- `citation` is the only format that batches: above 50 refs it sends requests in groups of 50. The default `maxExportRefs` is also 50, so batching only happens after that setting is raised above 50;
- `bibtex`, `biblatex`, `ris`, and `csljson` batch-export the whole set: `ris` and `csljson` send 1 local API batch request, while `bibtex` and `biblatex` additionally run a 2nd batch request in parallel to read the items' raw metadata for field alignment. The returned content is parsed in memory, and each record is paired with its ref by key or metadata fingerprint, never by position; a ref that cannot be located keeps only its own ref in the result. If the 2nd metadata request fails (for example Zotero returns 5xx), the export still completes: the body comes back as-is and refs that could not be paired stay in their bare `ref`-only shape. A caller abort is not this kind of degradation and still throws. One call supports at most 50 items;
- A single export only accepts refs from the same library; mixed cross-library exports are not supported.

### Example

```text
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex", run_in_background=true)
```

---

## zotero_browse

Browse library structure and taxonomy metadata. Supports paged queries.

### Parameters

| Parameter       | Type    | Default                 | Description                                                                                                                     |
| --------------- | ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | string  | none                    | Browse category: `libraries`, `collections`, `savedSearches`, `tags`, `itemTypes`, `itemFields` (required)                      |
| `library`       | object  | `{type: "user", id: 0}` | Target library (for collections, savedSearches, tags)                                                                           |
| `parentRef`     | string  | none                    | `collections` only: parent collection ref; omit it to list top-level collections                                                |
| `tagScope`      | string  | none                    | `tags` only: counting scope, supporting `library`, `collection`, `publications` (`publications` personal library only)          |
| `tagCollection` | string  | none                    | `tags` with `tagScope="collection"`: collection ref or exact name                                                               |
| `itemLevel`     | string  | `"top"`                 | Scoped `tags` only: `top` counts paper items only; `all` also counts child items (`library`/`collection` scopes only)           |
| `itemQuery`     | string  | none                    | Scoped `tags` only: count tags only on items matching this query                                                                |
| `itemQueryMode` | string  | `"titleCreatorYear"`    | Scoped `tags` only: item query mode for `itemQuery`, supporting `titleCreatorYear` or `everything` (default `titleCreatorYear`) |
| `itemType`      | string  | none                    | `itemFields` only: item type name for querying fields and creator types                                                         |
| `q`             | string  | none                    | Substring filter for tag names                                                                                                  |
| `match`         | string  | `"contains"`            | Tag filter match mode: `contains` or `startsWith`                                                                               |
| `offset`        | integer | `0`                     | Pagination offset                                                                                                               |
| `limit`         | integer | `20`                    | Item cap (bounded by `maxBrowseResults`, default 50)                                                                            |

### Output

Each `kind` returns the matching structured array:

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

List the child objects under an item or attachment.

### Parameters

| Parameter | Type     | Required | Description                                                                        |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Item ref or attachment ref                                                         |
| `include` | string[] | none     | Child types to include: `notes`, `attachments`, `annotations` (omit for all three) |

### Output

Returns `{ref, itemType?, serverId?, notes?, attachments?, annotations?}`, and each object class carries `total`, `returned`, and an `items` list.

### Notes

When an item has no child objects at all and the underlying `/children` endpoint returns an empty response, the result is treated as an empty child list.

### Example

```text
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

Read incremental update and deletion records of the library based on local transaction versions.

### Parameters

| Parameter           | Type     | Default                 | Description                                                                                                                                                                                                                       |
| ------------------- | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library`           | object   | `{type: "user", id: 0}` | Target library identifier                                                                                                                                                                                                         |
| `since`             | object   | none                    | Starting cursor `{serverId, library, version, include, unserved}`; omit it to get the initial baseline                                                                                                                            |
| `include`           | string[] | all except fulltext     | Monitored kinds: `items`, `collections`, `savedSearches`, `fulltext`, `deleted`                                                                                                                                                   |
| `run_in_background` | boolean  | `false`                 | Whether to start as a background job (managed by the Harness `ctx.jobs`; the parameter is always declared, and passing `true` while `enableRunInBackground=false` or with no `jobs` service mounted returns a structured refusal) |

### Output

A synchronous foreground call returns:
`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed, deleted?, totals?, unobservable?, truncated?}`.

- `changed`: changed objects by resource type (`items`, `childItems`, `trashedItems`, `collections`, `savedSearches`, `fulltextAttachments`);
- `deleted`: keys or tag names of deleted entries;
- `cursor`: returned only when the current batch was read completely and no concurrent write happened during the read; use it for later incremental requests. `cursor.include` contains only the resource classes the active Zotero build actually supports tracking; classes with no matching endpoint (such as older builds lacking the `/deleted` route) are recorded in `cursor.unserved`, are not counted toward coverage claims, and can still be passed back as-is in later incremental requests;
- `unobservable`: names the resource classes that cannot be observed because of version or endpoint limits, plus the reason. A missing endpoint (`not-served`) does not stop cursor generation; an unsupported key range (`range-not-covered`) or a read failure (`unreadable`) suppresses the cursor for the current batch, so advancing the cursor never skips change rows that were not read successfully.

### Example

```text
zotero_changes()
zotero_changes(since={serverId: "server1", library: {type: "user", id: 0}, version: 1234, include: ["items", "deleted"], unserved: []}, include=["items", "deleted"])
```

---

## zotero_create_note

Create a standalone research note or a child note under a given item.

### Supported Markdown syntax

The input `markdown` is converted before writing into the restricted HTML whitelist that Zotero 7+ supports natively (unknown syntax degrades safely to literal text, with no invented attributes and no raw HTML passthrough):

- Paragraphs and headings: blank lines separate paragraphs, and soft-wrapped lines join with spaces; ATX `#` to `####` headings are supported (five or more hashes stay literal text);
- Emphasis and highlights: `**bold**`, `*italic*` (underscores `_` stay literal to protect variable names); `==highlight==` becomes `<mark>`;
- Math: single-line or multi-line `$$...$$` blocks become `<math-display>`, inline `$formula$` becomes `<math-inline>` (rendered by native KaTeX; formula internals are protected from emphasis markup, and currency amounts such as `$100` are skipped automatically);
- Lists and task lists: `-`/`*` unordered lists and `1.`/`1)` ordered lists; `- [ ]` unchecked and `- [x]` checked task lists (rendered as native lists with checkbox controls and a `task-list` class name, with nesting support);
- Code: inline `` `code` `` and ``` fenced code blocks (special characters escaped inside, with no formatting applied);
- Quotes and tables: `>` quote paragraphs; pipe tables with a `---` separator row (the row follows GFM rules for header alignment: missing cells are padded, extra cells are dropped, and the column count follows the header);
- Links and rules: `[text](url)` (limited to the `https://`, `http://`, and `zotero://` schemes); `---` and `***` horizontal rules.

### Parameters

| Parameter     | Type     | Required | Description                                                                                                                                                             |
| ------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parentItem`  | string   | none     | Parent item ref; omit it for a standalone note. During streaming generation, metadata fields should come before `markdown`                                              |
| `collections` | string[] | none     | Collection refs or names (standalone notes only; child notes inherit the parent item's collections)                                                                     |
| `tags`        | string[] | none     | Tags to attach to the note                                                                                                                                              |
| `sourceRefs`  | string[] | none     | Source item refs to relate, written as `dc:relation` links (personal and group library items supported; group items map to `http://zotero.org/groups/<id>/items/<key>`) |
| `markdown`    | string   | ✓        | Note body in Markdown (character cap from `writeNoteMaxChars`, default 65536)                                                                                           |

### Output

- Created: `{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`;
- Declined by the user on the plan card: `{kind: "declined"}`;
- Write submitted but state unverified: `{kind: "committed-unverified", committed: true, retryable: false, reason}`.

### Example

```text
zotero_create_note(parentItem="zotero://user/0/item/ABCD1234", tags=["review"], markdown="## Methodology\n- Key point 1\n- Key point 2")
```

---

## zotero_update_item_tags

Add and remove an item's tags in one call. Read, merge, write: `add` and `remove` both take effect, existing tags keep their type (colored or automatic), and `remove` wins for an existing tag named in both lists.

### Parameters

| Parameter | Type     | Required | Description                                                          |
| --------- | -------- | -------- | -------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Target item ref (`zotero://user/0/item/<KEY>`)                       |
| `add`     | string[] | none     | Tags to add; they merge with existing tags, and duplicates collapse  |
| `remove`  | string[] | none     | Tags to remove, matched exactly; names that do not exist are ignored |

`add` and `remove` together need at least one entry (bounded by `writeListMaxItems`, default 50), otherwise the call is refused.

### Output

- Something changed: `{kind: "applied", ref, version, tags, added, removed, unchanged: false, libraryVersion, serverId?}`;
- Nothing changed: `{kind: "applied", ..., unchanged: true}`, with no PATCH sent and `version` being the version that was read;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_update_item_tags(ref="zotero://user/0/item/ABCD1234", add=["deep-learning", "close-reading"], remove=["to-read"])
```

---

## zotero_update_item_collections

Join and leave collections for an item in one call. Collection arguments may be `zotero://user/0/collection/<KEY>` refs or exact names (`zotero_browse` lists them); a name that fails to resolve fails before any write.

### Parameters

| Parameter | Type     | Required | Description                                                              |
| --------- | -------- | -------- | ------------------------------------------------------------------------ |
| `ref`     | string   | ✓        | Target item ref                                                          |
| `add`     | string[] | none     | Collection refs or exact names to join                                   |
| `remove`  | string[] | none     | Collection refs or exact names to leave; missing memberships are ignored |

`add` and `remove` together need at least one entry (bounded by `writeListMaxItems`), otherwise the call is refused.

### Output

- Something changed: `{kind: "applied", ref, version, collections, added, removed, unchanged: false, libraryVersion, serverId?}`;
- Membership already matched: `{kind: "applied", ..., unchanged: true}`, with no PATCH sent;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_update_item_collections(ref="zotero://user/0/item/ABCD1234", add=["Methodology"], remove=["Old collection"])
```

---

## zotero_create_collection

Create a collection, either top-level or under a parent collection.

### Parameters

| Parameter | Type   | Required | Description                                                                                                      |
| --------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`    | string | ✓        | New collection name (non-blank); a same-name sibling refuses this write                                          |
| `parent`  | string | none     | Parent collection: a `zotero://user/0/collection/<KEY>` ref or an exact name; omit it for a top-level collection |

### Output

- Created: `{kind: "applied", ref, key, version, name, parentRef?, libraryVersion, serverId?}`;
- Creation committed but the saved state cannot be verified: `{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown", ...}`, **not retryable**; check by key/ref in Zotero;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_create_collection(name="Field notes", parent="Methodology")
```

---

## zotero_delete_collection

Delete a collection. **Irreversible**: the collection's organization is removed, the items stay in the library, and child collections are deleted along with the parent. The plan card first lists the collection's item count and child collection count (shown as `unknown` when the read fails), and the delete carries the library version read before it.

### Parameters

| Parameter    | Type   | Required | Description                                                                     |
| ------------ | ------ | -------- | ------------------------------------------------------------------------------- |
| `collection` | string | ✓        | Collection to delete: a `zotero://user/0/collection/<KEY>` ref or an exact name |

### Output

- Deleted: `{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_delete_collection(collection="Field notes")
```

---

## zotero_create_item

Create a paper item from a closed field set. Zotero's `POST /items` only accepts Zotero item JSON, so there is no BibTeX/CSL-JSON intake: fields are assembled one by one, and nothing outside the closed set leaves this module.

### Parameters

| Parameter          | Type     | Required | Description                                                                                                   |
| ------------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `itemType`         | string   | ✓        | Item type: `webpage`, `journalArticle`, `book`, `conferencePaper`, `report`, `thesis`, `document`, `preprint` |
| `title`            | string   | none     | Title; at least one of `title` and `url` must be given                                                        |
| `url`              | string   | none     | Link; at least one of `title` and `url` must be given                                                         |
| `date`             | string   | none     | Publication date (in Zotero's stored form)                                                                    |
| `doi`              | string   | none     | DOI (written to the `DOI` field)                                                                              |
| `abstractNote`     | string   | none     | Abstract                                                                                                      |
| `publicationTitle` | string   | none     | Journal / proceedings / site name                                                                             |
| `creators`         | object[] | none     | Each entry has `creatorType`, plus `name` or a `firstName`/`lastName` pair                                    |
| `tags`             | string[] | none     | Tags written right after creation                                                                             |
| `collections`      | string[] | none     | Collection refs or exact names to join                                                                        |

### Output

- Created: `{kind: "applied", ref, key, version, itemType, title?, tags, collections, libraryVersion, serverId?}`;
- Committed but state unverified: `{kind: "committed-unverified", committed: true, retryable: false, reason, ...}`, **not retryable**;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_create_item(itemType="journalArticle", title="Attention Is All You Need", date="2017", doi="10.48550/arXiv.1706.03762", creators=[{"creatorType": "author", "name": "Vaswani, Ashish"}])
```

---

## zotero_update_note

Replace an existing Zotero note body with Markdown. The domain reads the note version before writing and converts the Markdown to Zotero-safe HTML in the PATCH; the target must have `itemType="note"`.

Standalone notes and child notes are both supported, and reading a version does not require the child object to carry collection fields. Both create and update check the original Markdown against `writeNoteMaxChars` before approval, counted by JavaScript string length including whitespace and markup, without automatic truncation.

### Parameters and output

| Parameter  | Type   | Required | Description       |
| ---------- | ------ | -------- | ----------------- |
| `ref`      | string | ✓        | Note item ref     |
| `markdown` | string | ✓        | New Markdown body |

Success returns `{kind: "applied", ref, version, libraryVersion, serverId?}`; a declined plan card returns `{kind: "declined"}`, and a version conflict returns `ZOTERO_WRITE_CONFLICT`.

---

## zotero_update_collection

Update a collection's name or parent collection. The write is refused when neither `name` nor `parent` is given, when the name is blank, when the target does not exist, when the parent does not belong to the personal library, or when the version precondition fails; omitting `parent` keeps the current parent, and a native caller may pass `null` to move it to the top level.

### Parameters and output

| Parameter    | Type   | Required | Description               |
| ------------ | ------ | -------- | ------------------------- |
| `collection` | string | ✓        | Collection ref            |
| `name`       | string | none     | New name                  |
| `parent`     | string | none     | New parent collection ref |

Success returns `{kind: "applied", ref, version, libraryVersion, serverId?}`; a declined plan card returns `{kind: "declined"}`.

---

## zotero_restore_items

Restore selected items from the personal library Trash. Each item's version is read and PATCHed to `deleted: 0` independently, success or failure is settled item by item, and one call takes at most 50 items.

### Parameters and output

| Parameter | Type     | Required | Description          |
| --------- | -------- | -------- | -------------------- |
| `refs`    | string[] | ✓        | Item refs to restore |

Output is `{kind: "restored", restored, failed, serverId?}`; version conflicts are never retried automatically.

Child notes, child attachments, and annotations are supported. The result body lists every restored object's ref, version, and library version, plus every failed object's ref, error code, and reason; the card reports the real restored and failed counts, and shows a warning on partial failure.

---

## Zotero saved-search tools

`zotero_create_saved_search`, `zotero_update_saved_search`, and `zotero_delete_saved_search` use Zotero's native saved-search conditions. Creation needs at least one condition; when the create response is lost or its saved state cannot be verified, the result is `committed-unverified` (`retryable: false`), so check by search ref/key first and never create a duplicate.

Creation takes `name` and `conditions` (each with `condition`, `operator`, `value`); update takes `search` plus at least one of `name` or `conditions`; delete takes `search`. Update and delete both use object/library version preconditions.

An unverified creation receipt distinguishes `commit-unknown` from `saved-state-unverified`, and the body and presentation metadata keep the known ref, key, version, and server identity. Without a known identity, check Zotero first and do not create again.

## scholarly_save_to_zotero

Save scholarly search results into the personal library through the local write approval flow. The output is a union of `declined`, `applied`, and `committed-unverified`. Only `applied` carries the successfully saved `papers`, with the created items' ref, key, version, tags, collections, and library version; unverified results keep their original identity and reason and must not be retried. The card and conversation replay tell the three outcomes apart from the persisted content and state metadata.

---

## zotero_update_item

Correct an item's scalar metadata. Field validity follows Zotero's `itemTypeFields`: a field the item type does not accept is refused before any PATCH, and values must be non-blank text. The write carries the item's version precondition (`If-Unmodified-Since-Version`).

### Parameters

| Parameter | Type   | Required | Description                                                                                 |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `ref`     | string | ✓        | Target item ref (`zotero://user/0/item/<KEY>`)                                              |
| `set`     | object | ✓        | At least one of: `title`, `date`, `url`, `doi`, `abstractNote`, `publicationTitle`, `extra` |

### Output

- Something changed: `{kind: "applied", ref, version, changed, libraryVersion, serverId?}` (`changed` lists the submitted field names in lexical order);
- Declined on the plan card: `{kind: "declined"}`;
- Version precondition lost: `ZOTERO_WRITE_CONFLICT`. The object was changed concurrently; run the tool once more (the re-run reads the version again).

### Example

```text
zotero_update_item(ref="zotero://user/0/item/ABCD1234", set={"title": "Attention Is All You Need (2017)", "doi": "10.48550/arXiv.1706.03762"})
```

---

## zotero_delete_library_tags

Delete tags by name across the whole library. **Irreversible**: the tags come off every item in the library. The plan card first pages through the entire tag list, then lists each tag's item count: a tag the list carries without a count shows `unknown items`, and only a name absent from the whole list counts as a proven no-op, so a tag beyond the first page is never misread as invalid. When the read fails, every entry shows `unknown items` and the delete still carries the library version read before it; names Zotero does not know are skipped silently, so a retry is idempotent.

### Parameters

| Parameter | Type     | Required | Description                                                                    |
| --------- | -------- | -------- | ------------------------------------------------------------------------------ |
| `tags`    | string[] | ✓        | Tag names to delete (1..`writeListMaxItems`, with a server cap of 50 per call) |

### Output

- Deleted: `{kind: "deleted", deletedTags, libraryVersion, serverId?}` (`deletedTags` is the requested list, sorted by name);
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_delete_library_tags(tags=["stale", "obsolete"])
```

---

## zotero_batch_items

Create items, update tags and collection membership, or move items with their child notes, attachments, and annotations to the trash in one call. Item deletion marks the whole object graph as deleted through versioned PATCH requests and reads it back to verify; when part of the graph fails, `failed.completedRefs` lists the objects confirmed in the trash. The operation is recoverable from the Zotero trash and is not a permanent erase. All operations are merged into one plan card confirmation; the card lists every field of every create request in full (including collection membership) and does not omit the eleventh item or any after it.

The total number of operations in one call (create, update, and delete combined) is bounded by `writeListMaxItems` (default 50). The receipt for each create is listed by input index with the ref, key, version, and available title/URL after Zotero saves it. If a create's commit or saved state cannot be verified, it appears in `unverified` with `retryable: false`; do not submit it again, and check by ref/key. Missing, duplicate, contradictory, or out-of-range batch indices are reported as unverified results rather than dropped silently. A version conflict on one item (HTTP 412) is recorded in the `failed` array and does not stop the rest.

### Parameters

| Parameter | Type     | Required | Description                                                                                                                             |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | object[] | none     | Items to create. Each has `itemType` (required), `title` or `url`, and optionally `tags`, `collections`, `creators`, and similar fields |
| `update`  | object[] | none     | Items to update. Each has `ref` (required), and optionally `addTags`, `removeTags`, `addCollections`, `removeCollections`               |
| `delete`  | string[] | none     | Item refs to move to the trash (`zotero://user/0/item/<KEY>`)                                                                           |
| `reason`  | string   | none     | Operation note, shown on the plan card                                                                                                  |

At least one of `create`, `update`, or `delete` must be given, and the total count must not exceed the cap.

### Output

- Batch result: `{kind: "applied", total, created: [...], updated: [...], deleted: [...], unverified: [...], failed: [...], libraryVersion?, serverId?}`;
  - `created`: `[{index, ref, key, version, itemType, title?, url?}]`, with fields taken from the object Zotero saved;
  - `updated`: `[{ref, unchanged, addedTags, removedTags, addedCollections, removedCollections}]`
  - `deleted`: `[{ref, key, deleted: true, version, children: [ref...]}]`, listing the root items verified into the trash together with all descendants;
  - `unverified`: `[{op: "create", index, committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}]`;
  - `failed`: `[{op, index?, ref?, code, message, completedRefs?}]`, recording an item-level failure; when a deletion completes only partly, `completedRefs` lists the objects confirmed in the trash;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_batch_items(
  reason="Batch organizing machine learning papers and trashing obsolete drafts",
  create=[
    {"itemType": "journalArticle", "title": "Attention Is All You Need", "tags": ["Transformer"]}
  ],
  update=[
    {"ref": "zotero://user/0/item/ABCD1234", "addTags": ["LLM", "Survey"], "removeTags": ["ToRead"]}
  ],
  delete=["zotero://user/0/item/OLD00001"]
)
```

---

## Write boundaries and safety

Write tools are not registered by default, need `writeEnabled` turned on explicitly in configuration, and operate only on the personal library (`zotero://user/0/`).

1. Two-tier confirmation:
   - Session approval policy (`ctx.approval.request`): follows the session policy; a policy of `never` rejects automatically. The prompt wording distinguishes the blast radius: an ordinary add or change, a recoverable move to the trash, or an irreversible deletion;
   - Plan review card: shows the exact Markdown changes to the user and runs after confirmation; an unapproved request returns `{kind: "declined"}`. The plan body uses only the Markdown subset the host renderer supports.
2. Local API authentication:
   - A write must carry an API key issued by local Zotero;
   - The first write needs confirmation in Zotero's local authorization dialog (Allow, Always Allow, or Decline);
   - With `writePersistKey` on, the persistent key issued by Always Allow is stored safely in the host credentials manager.
3. Shell write interception:
   - A listener detects write commands aimed at the local API, intercepts them, and escalates them to a Harness approval request, so unauthorized scripts cannot modify the library.

   Detection reads command text only and cannot cover every path. These paths are not detected:
   - writing a request into a script file and then running it (`bash build.sh`);
   - an interpreter call whose command text does not spell the endpoint (URLs assembled at runtime in `python -c '...'` or `node -e '...'`); an interpreter call that spells the endpoint in its command text is still detected;
   - a URL hidden in an environment variable, a heredoc, or an encoding;
   - a loopback port other than the configured one (exception: write requests to `/api/users/` and authorize calls are detected on any loopback port);
   - any binary of the user's own.

   The system prompt keeps the model on the write tools, and shell writes that bypass them are gated by this interception and approval. To make the library entirely unreachable from the shell, run the session without an unconstrained shell: use `tools.restrict({ deny: ["bash"] })` per agent, or a preset without a shell. A raw write that is confirmed and allowed bypasses the plugin's write domain entirely: no plan card, no version precondition, no Markdown-to-note HTML conversion, and no provenance. That is the price accepted at the moment of confirmation.

---

## Error codes

| Error code                          | Description                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ZOTERO_NOT_RUNNING`                | Zotero is not running or the local port is unreachable                                           |
| `ZOTERO_API_DISABLED`               | Zotero is running but the local API is not enabled in advanced settings (403)                    |
| `ZOTERO_API_VERSION`                | Unsupported local API version                                                                    |
| `ZOTERO_NOT_IMPLEMENTED`            | The local API explicitly returns 501; endpoint or format unimplemented in this version           |
| `ZOTERO_SERVER_MISMATCH`            | Referenced Server ID does not match the running Zotero instance                                  |
| `ZOTERO_NOT_FOUND`                  | Referenced item, collection, or saved search does not exist                                      |
| `ZOTERO_RANGE_UNSUPPORTED`          | The server does not keep change history back to the requested version (409)                      |
| `ZOTERO_NO_ATTACHMENT`              | No attachment of the requested type exists under the item                                        |
| `ZOTERO_NO_FULLTEXT`                | The attachment has no full-text index                                                            |
| `ZOTERO_FILE_MISSING`               | The recorded local attachment file does not exist on disk                                        |
| `ZOTERO_INVALID_REF`                | Ref format violates the `zotero://` grammar or targets an unsupported library                    |
| `ZOTERO_INVALID_ARGUMENT`           | Argument violates domain constraints                                                             |
| `ZOTERO_SCOPE_AMBIGUOUS`            | A collection or saved-search name matches several same-name objects                              |
| `ZOTERO_TIMEOUT`                    | Provider request timed out                                                                       |
| `ZOTERO_RESPONSE_TOO_LARGE`         | API response stream exceeds the read cap                                                         |
| `ZOTERO_OUTPUT_TOO_LARGE`           | Export content exceeds the character cap                                                         |
| `ZOTERO_CAPABILITY_UNAVAILABLE`     | The current provider does not declare the required capability                                    |
| `ZOTERO_PROVIDER_UNAVAILABLE`       | The configured provider is not registered or the method is unimplemented                         |
| `ZOTERO_UNEXPECTED`                 | Abnormal response payload or unexpected behavior                                                 |
| `ZOTERO_WRITE_UNAUTHORIZED`         | Write not authorized: key missing, expired, or rejected in the authorization dialog              |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` | The plan review card cannot start interaction (no interactive channel or a system-level failure) |
| `ZOTERO_WRITE_CONFLICT`             | Write version precondition conflict (412); the object was modified externally                    |
| `ZOTERO_WRITE_RATE_LIMITED`         | Zotero authorization endpoint rate limited (429)                                                 |

---

## Scholarly literature retrieval component tools (`dsh-zotero/scholarly`)

The bundle component `dsh-zotero/scholarly` ships with the package and is off by default. Enabling it under "Included components" in the plugin manager mounts it and provides the following 7 model tools:

### scholarly_search

Multi-source literature retrieval across arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP. It supports automatic semantic routing and multi-source RRF fusion with deduplication, and checks the local Zotero library for saved status automatically.

#### Parameters

| Parameter     | Type     | Default       | Description                                                                                                                                                    |
| ------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`       | string   | required      | Topic words, paper title, or author name                                                                                                                       |
| `sources`     | string[] | none          | Optional source filter (`arxiv`, `openalex`, `crossref`, `semanticscholar`, `pubmed`, `europepmc`, `dblp`); by default routed automatically by topic semantics |
| `year_from`   | integer  | none          | Start publication year; with `sort="date"` and this omitted, only the previous year is used by default                                                         |
| `year_to`     | integer  | none          | End publication year                                                                                                                                           |
| `open_access` | boolean  | none          | Whether to return only papers with free open-access full text                                                                                                  |
| `sort`        | string   | `"relevance"` | Sort order: `relevance`, `date` (newest first; only the previous year when `year_from` is omitted), `citations` (most cited first)                             |
| `categories`  | string[] | none          | arXiv category filter (such as `cs.CL`, `stat.ML`)                                                                                                             |
| `limit`       | integer  | `8`           | Paper cap                                                                                                                                                      |
| `abstract`    | string   | `"snippet"`   | Abstract verbosity: `none`, `snippet`, `full`                                                                                                                  |

---

### scholarly_get

Aggregate the complete scholarly graph metadata of one paper by DOI, arXiv ID, PMID, PMCID, URL, or exact title (authors, venue, abstract, citation count, open-access full-text link, and local Zotero library match status).

#### Parameters

| Parameter | Type   | Default  | Description                                                                                           |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `id`      | string | required | DOI (such as `10.1038/nature1234`), arXiv ID (such as `2301.07041`), PMID, PMCID, URL, or exact title |

#### Failure semantics

When an index cannot answer (rate limited, timed out, service error), the result lists it as `Unanswered sources: <index> (<reason>)`, and successful hits carry `Notice: <index> (<reason>)`. An unavailable index does not mean the paper does not exist: only when every index answered normally and none matched does the tool ask the caller to check the identifier.

---

### scholarly_citations

Trace a paper's citation graph: the list of papers citing this work (citations), this paper's reference list (references), or semantically related papers (related).

#### Parameters

| Parameter   | Type    | Default  | Description                                                                                                                              |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string  | required | DOI, arXiv ID, or PMID                                                                                                                   |
| `direction` | string  | required | Trace direction: `citations` (papers citing this paper), `references` (papers this paper cites), `related` (semantically related papers) |
| `limit`     | integer | `10`     | Paper cap                                                                                                                                |

---

### scholarly_read

Tiered reading of lawful open-access full text with passage-level BM25 evidence location. Supports outline extraction (`outline`), section-targeted reading (`section`), and BM25 evidence passage matching from a natural-language question (`query`).

#### Parameters

| Parameter   | Type    | Default    | Description                                                                                    |
| ----------- | ------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `id`        | string  | required   | arXiv ID, DOI, PMID, PMCID, or a direct PDF link                                               |
| `outline`   | boolean | none       | Set to `true` to return only the multi-level outline and character spans                       |
| `section`   | string  | none       | Section number or title to read closely (such as `"2"` or `"Methodology"`)                     |
| `query`     | string  | none       | Natural-language question; BM25 ranks the most relevant evidence passages across the full text |
| `passages`  | integer | `5`        | Number of top passages returned in `query` mode (1-12)                                         |
| `start`     | integer | `0`        | Starting character offset for chunked reading                                                  |
| `max_chars` | integer | config cap | Maximum characters read per call                                                               |

#### Network boundary

The retrieval tools (`scholarly_search` / `scholarly_get` / `scholarly_citations` / `scholarly_verify`) reach only the fixed scholarly-index host allowlist (`src/scholarly/transport/hosts.ts`) and refuse loopback and private addresses. Full-text resolution is the exception: open-access PDFs and direct PDF links live on the publisher's own domains, so that path checks only public/loopback addresses and **does not apply the host allowlist**, following at most 5 redirects. The URL passed as `id`, and any PDF address it resolves to, may therefore be any public host, so read only literature links from sources you trust.

---

### scholarly_cite

Fetch standard citation formats directly from the official DOI registration agencies (Crossref, DataCite) through content negotiation.

#### Parameters

| Parameter | Type     | Default  | Description                                                                                                           |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ids`     | string[] | required | DOI, arXiv ID, or PMID list (at most 30 papers per call; going over is an error, with no silent truncation)           |
| `format`  | string   | required | Citation format: `bibtex`, `ris`, `csljson`, `text` (formatted reference)                                             |
| `style`   | string   | `"apa"`  | CSL style ID when `format="text"` (such as `apa`, `ieee`, `nature`, `china-national-standard-gb-t-7714-2015-numeric`) |
| `locale`  | string   | none     | Language code (such as `zh-CN`, `en-US`)                                                                              |

---

### scholarly_verify

Reference truthfulness and accuracy verification. Parses the authors, year, title, and DOI from reference text and compares them field by field against the official Crossref registry, catching fabricated references, mismatched DOIs, wrong years, and retraction status.

#### Parameters

| Parameter    | Type     | Default  | Description                                                                                                   |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `references` | string[] | required | Reference text list to verify (at most 40 papers per call; going over is an error, with no silent truncation) |

#### Verdicts

Each reference returns one of four verdicts: `VERIFIED` (the registry record exists and every compared field agrees), `CHECK` (the record exists but a field differs or the work is retracted), `NOT FOUND` (the registry answered and holds no such record), `UNVERIFIED` (the registry was unreachable, so nothing is concluded about this entry). An unreachable registry is never reported as `NOT FOUND`.
