<p align="right"><a href="tools.md"><b>中文</b></a></p>

# Tool Reference

dsh-zotero registers 23 local tools (8 read tools and 15 write tools) that work with the Zotero library through the local Zotero HTTP API. The 15 write tools are off by default and need `writeEnabled` turned on in configuration, and they operate only on the personal library (`zotero://user/0/`). Another 7 scholarly retrieval tools belong to the separate `dsh-zotero/scholarly` component, which ships with the package and is off by default; enabling that component enables those tools. Every item reference (ref) is a stable identifier in `zotero://user/0/item/<KEY>` (personal library) or `zotero://group/<ID>/item/<KEY>` (group library) form.

All eight local read tools share a delivery envelope. `{delivery:"inline", data:…}` contains the complete domain result within both budgets. `{delivery:"file", version:1, tool, sessionId, callId, summary, file, facts}` contains bounded facts and a standard Harness FileBlock. Its immutable JSON file contains `{version:1, tool, request, data}` with the complete domain result. Page completeness (`page` or `complete`) is independent of delivery. Parse large single-line fields with the official `run_code` Node file interface; line-oriented previews can truncate long lines.

When argument validation fails (for example `refs` sent as `ref`), all dsh-zotero tools attach a parameter-correction hint after the `invalid arguments` error, indicating the rejected parameter and the intended name. Matching ignores case and `_`/`-`, and an adjacent character transposition counts as one edit. The hint appears only for a unique near-match.

Files are saved with `AttachmentStore.saveFileStream`; validated receipts live in the `zotero_results` storage domain. Both services are required for oversized or managed background results. Any save, index, cancellation or integrity failure is an error; full text never falls back inline. Completed `job_output` for an owned Zotero job appends the same file reference without changing its canonical value. Nested PTC calls forward standard file context. Original background acknowledgements retain `resultSessionId`; the client can read an already-persisted receipt after restart, but running jobs are not resumed.

The authenticated `GET /api/zotero/result?sessionId=<id>&seq=<event>&index=<file>` route reads only a file recorded at those persistent coordinates, or the verified receipt of that event's background acknowledgement. It does not accept a path or arbitrary attachment ID. Copy/download become available after the entire verified stream has completed. Attachments use the host lifecycle and may occupy disk beyond a Session's lifetime; this plugin does not delete shared files.

---

## zotero_search

Search for items in the library. Supports metadata matching and full-text search.

### Parameters

| Parameter     | Type                           | Default             | Description                                                                                                                                                                             |
| ------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`       | string                         | none                | Free-text query; omit it to browse all items                                                                                                                                            |
| `mode`        | `"metadata"` \| `"everything"` | `"metadata"`        | Search mode: `metadata` matches title/author/year; `everything` also searches the full-text index                                                                                       |
| `scope`       | object                         | `{kind: "library"}` | Search scope: `{kind:"library"}`, `{kind:"collection", refOrName}`, `{kind:"savedSearch", refOrName}`, or `{kind:"publications"}` (`publications` is personal library only)             |
| `library`     | object                         | none                | Target library: `{type:"user", id:0}` or `{type:"group", id}`; sets the context when `scope` is given a name                                                                            |
| `itemTypes`   | string[]                       | none                | Zotero item types (such as `journalArticle`), combined with OR                                                                                                                          |
| `tags`        | string[]                       | none                | Tag list; `tagMatch` decides how they combine                                                                                                                                           |
| `tagMatch`    | `"all"` \| `"any"`             | `"all"`             | Multi-tag matching: `all` is AND, `any` is OR (used with `tags`)                                                                                                                        |
| `excludeTags` | string[]                       | none                | Tags to exclude (NOT)                                                                                                                                                                   |
| `itemLevel`   | `"top"` \| `"all"`             | `"top"`             | Item level: `top` searches top-level items only; `all` also searches child items and attachments (`library`/`collection` scopes only; `publications` and saved searches serve one list) |
| `sort`        | string                         | `"dateModified"`    | Sort field: `dateModified`, `dateAdded`, `date`, `title`, `creator`                                                                                                                     |
| `direction`   | `"asc"` \| `"desc"`            | `"desc"`            | Sort direction                                                                                                                                                                          |
| `offset`      | integer                        | `0`                 | Pagination offset                                                                                                                                                                       |
| `limit`       | integer                        | `10`                | Item cap (bounded by `maxSearchResults`, default 20)                                                                                                                                    |

### Output

The returned object contains `normalizedQuery`, `queryWasEmpty`, `maximum`, `scope`, `items` (with ref, title, creatorSummary, authors, venue, year, itemType, parentRef, bestAttachmentRef, bestAttachmentType, attachmentSize, extra, citationKey, citationKeySource, citationKeyConflict, doi), `total`, `offset`, `returned`, `nextOffset`, and optional `nextActions` and `supplemental` (with note hits `{kind:"noteBody", items, scanned, truncated}`). The model search surface cannot access the trash; the library panel owns that scope. Native `citationKey` wins over a citekey in `extra`, and conflicts are explicit.

### Notes

On the initial query (offset 0) with a `library`, `publications`, or `collection` scope, the plugin scans note bodies and lists matching items in `supplemental.items`. `items` and `total` count primary result items only.

### Example

```text
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

Read detailed metadata and related child content; resolve locations explicitly of a single paper or attachment.
`ref` is one string; pass multiple known items as `refs[]` to `zotero_get_batch`.

### Parameters

| Parameter    | Type                                        | Required | Description                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`        | string                                      | ✓        | Item ref or attachment ref (`zotero://user/0/item/<KEY>` or `zotero://user/0/attachment/<KEY>`)                                                                                                                             |
| `include`    | `("notes"\|"annotations"\|"attachments")[]` | none     | Child content types to include (items include direct and annotations; attachments include their annotations)                                                                                                                |
| `fields`     | `"standard"` \| `"all"`                     | none     | Field scope: `standard` (default) returns the normalized field model; `all` adds `extraFields`                                                                                                                              |
| `locations`  | `"none"` \| `"best"` \| `"included"`        | none     | Default `none`: metadata only. `best` resolves the target attachment or item’s best attachment. `included` resolves returned attachments and requires `include:["attachments"]`; attachment refs accept only `none`/`best`. |
| `childPages` | object                                      | none     | Independent `{offset,limit}` windows for notes/annotations/attachments. Omitted kinds read all requested rows and full normalized bodies.                                                                                   |

### Output

Returns a detailed item or attachment object:

- `ref`, `itemType`, `title`;
- `creators`: list of creator objects (each with `creatorType`, plus optional `name`, `firstName`, `lastName`);
- `citationKey`: a separate first-class field, from Zotero's native value or parsed from `extra`; `citationKeySource` identifies its source and `citationKeyConflict` preserves both values when they disagree;
- `extra`: extra metadata (such as arXiv ID or PMID);
- `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`;
- `tags`, `collections`, `children`, `bestAttachment`, `relations`;
- `contentType`; explicit location requests add `location` (`file`, `url`, or `unavailable` with a reason);
- the native extra fields `extraFields` when `fields="all"`;
- the requested child sets: `notes`, `annotations`, `attachments` (each with total, returned, items, completeness and, for explicit pages, offset/limit/nextOffset).

### Example

```text
zotero_get(ref="zotero://user/0/item/ABCD1234", include=["notes", "annotations", "attachments"])
```

---

## zotero_get_batch

Read known item or attachment refs in input order. Each result reports success or failure independently; batches accept up to 50 unique refs with concurrency `max(1, min(8, graphConcurrency, maxInFlightRequests - 1))`, reserving an interactive-read slot when transport capacity permits. Use `zotero_get` for one ref and this tool for multiple refs.

### Parameters

| Parameter | Type     | Default      | Description                                                                                                                                                                                   |
| --------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs`    | string[] | none         | 1–50 unique item or attachment refs, returned in this order                                                                                                                                   |
| `fields`  | string   | `"standard"` | `standard` or `all`; the latter preserves unconsumed Zotero data fields                                                                                                                       |
| `include` | object   | none         | `children` includes notes, annotations, and attachments; `attachments` includes attachments only; `relations:true` includes relations; `bestAttachment` resolves the best attachment location |

### Output

`{items, counts}`. `items` follows the input order; each result is `{ref, status:"ok", item}` or `{ref, status:"error", code, message, next?}`. `counts` contains `requested`, `succeeded`, and `failed`.

### Example

```text
zotero_get_batch(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], fields="standard")
```

---

## zotero_match_references

Reconcile BibTeX, DOI, or reference fields against the local Zotero library. It uses only the local library, does not call scholarly tools, and never writes. Exact DOI matching pages through top-level item metadata once per call because Zotero quick search does not index DOI fields. Each call accepts up to 50 references. Only a unique high-confidence result is `matched`; weak or competing candidates are `ambiguous`, and citekey-source disagreements are `conflict`.

### Parameters

| Parameter          | Type     | Default | Description                                                                                                                 |
| ------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `references`       | object[] | none    | 1–50 entries with unique `inputId`; each needs a `doi` or `title`, and may include `bibKey`, `authors`, `year`, and `venue` |
| `includeFieldDiff` | boolean  | `false` | Include comparable title, DOI, year, author, and venue differences for unique matches                                       |

### Output

`{items}` follows the input order. Each row has `inputId` and `status`; incomplete search pages include `reason` and leave the row unmatched; matches and candidates include `ref`, `citationKey`, optional `citationKeySource`, title, authors, year, DOI, venue, match method, and confidence; `citationKeyConflict` explicitly flags conflicts. `fieldDiff` reports comparable differences in title, DOI, year, authors, and venue for reviewing Bib/TeX changes.

### Example

```text
zotero_match_references(references=[{inputId:"ref-1", bibKey:"doe2024", doi:"10.1000/example", title:"A Paper"}, {inputId:"ref-2", title:"Another Paper", authors:["Jane Doe"], year:2023}, {inputId:"ref-3", doi:"10.1000/third"}], includeFieldDiff=true)
```

---

## zotero_retrieve

Two mutually exclusive modes. `evidence`: extract query-relevant passages from one paper's multiple sources and rank them (lexical BM25; with the enrichment component's local semantic ranking on, a lexical and a semantic route fuse by RRF, each passage labeled with `matchKind`). `fulltext`: read one document (bounded by `maxFulltextChars`) in source-order character windows, without ranking or chunking; parsed Markdown is preferred and Zotero index text is the explicit fallback.

### Parameters

| Parameter          | Type     | Default    | Description                                                                                                                                                                                                                     |
| ------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`             | string   | `evidence` | Read mode; omitted means `evidence`. `evidence`: rank passages against query; `fulltext`: read one document in paged character windows                                                                                          |
| `ref`              | string   | none       | `evidence` mode: item ref                                                                                                                                                                                                       |
| `query`            | string   | none       | `evidence` mode: ranking keywords, limited to 2,000 characters; longer input is refused before reading.                                                                                                                         |
| `queryVariants`    | string[] | none       | `evidence` mode: up to 4 alternative phrasings (synonyms or field terminology), each limited to 2,000 characters; each is ranked separately and a passage keeps its best score.                                                 |
| `sources`          | string[] | all 4      | `evidence` mode: retrieval sources `annotation`, `note`, `abstract`, `fulltext`                                                                                                                                                 |
| `passages`         | integer  | `4`        | `evidence` mode: passage cap (bounded by `maxEvidencePassages`)                                                                                                                                                                 |
| `attachmentPolicy` | string   | `"best"`   | `evidence` mode: full-text attachment policy `best`, `allIndexed`, `specified`                                                                                                                                                  |
| `attachmentRefs`   | string[] | none       | `evidence` mode, for `attachmentPolicy="specified"`: attachment refs                                                                                                                                                            |
| `source`           | object   | none       | `fulltext` mode: exactly one source. `kind="ref"` selects a Zotero attachment by `ref`; `kind="artifactId"` selects a stored parsed artifact by its 64-character lowercase hex id (a malformed id is an invalid-argument error) |
| `start`            | integer  | `0`        | `fulltext` mode: character offset of this window                                                                                                                                                                                |
| `maxChars`         | integer  | none       | `fulltext` mode: characters per window, defaulting to and bounded by `fulltextWindowChars`                                                                                                                                      |

### Output

The returned structure contains `mode`. `evidence` mode carries `ref`, `attachmentRef`, `attachmentContentType`, `coverage`, `attachments`, `evidence` (passage list, each with source, sourceRef, attachmentRef, text, chunkIndex, chunkCount, comment, pageLabel, `matchKind`, matchedFields), `truncated`, `sourcesSkipped`, `queryTerms`, `rankedRoutes`, and `noMatch`. `fulltext` mode carries only `mode` and `fulltext` (`sourceKind`, `sourceLabel`, `textFormat`, `artifact`, `coverage`, `totalChars`, `inputTruncated`, `start`, `end`, `text`, `isTruncated`, `nextStart`, `attachmentRef`, `spillRef`). It carries no evidence-side field at all: no `ref`, `evidence`, `truncated`, `sourcesSkipped`, `queryTerms`, `noMatch`, or `rankedRoutes`.

### Notes

- `matchKind` gives the reason a passage returned: `lexical` (the passage text carries the query's words and may be quoted as such), `semantic` (meaning only, not quoted as containing the query's terms), `hybrid` (both);
- Only `annotation` sources carry a page label (`pageLabel`); full-text passages give no page numbers;
- Unavailable or unindexed sources are recorded in `sourcesSkipped`; `noMatch` does not mean the item has nothing on the subject;
- Annotation content ranks the highlighted text and the user comment together, and `matchedFields` marks whether the match came from `text` or `comment`; a semantic hit names no field (the wording does not overlap);
- Under the multi-attachment policies, unindexed attachments are marked `unindexed` and attachments that were not read are marked `unread`;
- In `fulltext` mode, start at `start=0` and follow `nextStart` until `isTruncated` is false; windows are exact character slices, so concatenating them in order yields the complete document. `textFormat` `markdown` comes from a parsed artifact, `text` from Zotero's index. `inputTruncated: true` means the document was cut to `maxFulltextChars`, so the windows cover only that bounded portion. When a `source.kind="ref"` read misses a parsed artifact it falls back to Zotero index text; a `source.kind="artifactId"` miss fails explicitly instead of inventing a source. A parsed-artifact window carries no `coverage`; an index-text window carries Zotero's own indexing coverage. On a long document with more windows to come, the first window also carries `spillRef` (`locator`, `bytes`, `retrievalHint`) when the host provides spill storage: a one-handle copy of the whole bounded text; without a store only the window chain is available. Windows are sized under the inline delivery budget by default; a lowered inline budget can still force file delivery. A read never starts a parse, download, or upload.

### Example

```text
zotero_retrieve(mode="evidence", ref="zotero://user/0/item/ABCD1234", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
zotero_retrieve(mode="fulltext", source={kind: "ref", ref: "zotero://user/0/attachment/EFGH5678"}, start=0)
```

---

## zotero_export

Pass a non-empty `outputFile` to write bibliography, translator, or `csv` text (`citation` rejects it). The Harness filesystem resolves the path against the calling session’s current directory and enforces that session’s sandbox policy. Foreground, background, and promoted jobs finish after writing and required internal persistence when oversized or background. Write failures fail the tool or job. Writing the file is not a session delivery: when the file should join the session’s declared deliverables, the model calls the Harness `present` tool with that path.

Generate formatted citations or export data files.

### Parameters

| Parameter    | Type     | Default                          | Description                                                                                                     |
| ------------ | -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `refs`       | string[] | none                             | Item ref list (required; one call is bounded by `maxExportRefs`, default 50)                                    |
| `format`     | string   | none                             | Export format: `citation`, `bibliography`, `bibtex`, `biblatex`, `ris`, `csljson`, `csv` (required)             |
| `style`      | string   | config value                     | CSL style identifier (citation and bibliography only)                                                           |
| `locale`     | string   | config value (default `"en-US"`) | CSL locale (citation and bibliography only; defaults to the configured `defaultLocale`)                         |
| `outputFile` | string   | none                             | Optional session-workspace path that receives the bibliography, translator, or CSV text (`citation` rejects it) |

`run_in_background` is not a fixed parameter: it appears only while `enableRunInBackground` is on and a `jobs` service is composed; an undeclared `true` still receives a structured refusal (`INVALID_ARGS` / `TOOL_CONTEXT_UNAVAILABLE`).

### Output

When the foreground call finishes synchronously:

- `citation`: `{citations: [{ref, text}]}`;
- `bibliography`: `{text}`;
- `bibtex` / `biblatex` / `ris` / `csljson`: `{text, items: [{ref, citationKey, exportKey, title, entryIndex, start, end}]}`; `citationKey` is Zotero's native/extra citekey, while `exportKey` is the translator-generated entry key;
- `csv`: `{text}` (Zotero's own whole-table export, with no per-document entries).

When it runs in the background (or is promoted automatically after the foreground wait times out):
Returns `{kind: "background", jobId}` or `{kind: "promoted", jobId, timeoutMs, message}`. Job progress shows in the Web session header and the logs, and the result is written to the job artifact when done.

### Notes

- Total refs are bounded by `maxExportRefs` (default 50). The six formats other than `citation` (`bibliography`, `bibtex`, `biblatex`, `ris`, `csljson`, `csv`) take at most 50 items per call; exceeding this returns an error;
- `citation` is the only format that batches: above 50 refs it sends requests in groups of 50. The default `maxExportRefs` is also 50, so batching only happens after that setting is raised above 50;
- `bibtex`, `biblatex`, `ris`, and `csljson` use one translator request and one bounded raw-metadata batch for citekeys and alignment. The returned content is parsed in memory, and each record is paired with its ref by key or metadata fingerprint, never by position; a ref that cannot be located keeps only its own ref in the result. If the metadata request fails (for example Zotero returns 5xx), the export still completes: the raw body is retained and refs that could not be paired stay in their bare `ref`-only shape. A caller abort still throws. One call supports at most 50 items;
- A single export only accepts refs from the same library; mixed cross-library exports are not supported.

### Example

```text
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex", run_in_background=true)
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
- `collections`: `{ref, name, parentRef?, path, depth, childCount?, itemCount?}` (`childCount` and `itemCount` are Zotero's own counts of direct sub-collections and direct items; omitted when unreported, and `childCount: 0` confirms a childless collection)
- `savedSearches`: `{ref, name, conditions?}`
- `tags`: `{tag, count?}`
- `itemTypes`: `{itemType, localized?}`
- `itemFields`: `{field, localized?}` or `{creatorType, localized?}`

Collection and saved-search results also carry a top-level `libraryVersion` taken from a valid `Last-Modified-Version` response header; a missing or malformed version fails explicitly rather than being invented.

### Example

```text
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_changes

Read incremental update and deletion records of the library based on local transaction versions.

### Parameters

| Parameter | Type     | Default                 | Description                                                                                            |
| --------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `library` | object   | `{type: "user", id: 0}` | Target library identifier                                                                              |
| `since`   | object   | none                    | Starting cursor `{serverId, library, version, include, unserved}`; omit it to get the initial baseline |
| `include` | string[] | all except fulltext     | Monitored kinds: `items`, `collections`, `savedSearches`, `fulltext`, `deleted`                        |

`run_in_background` is not a fixed parameter: it appears only while `enableRunInBackground` is on and a `jobs` service is composed; an undeclared `true` still receives a structured refusal (`INVALID_ARGS` / `TOOL_CONTEXT_UNAVAILABLE`).

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

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

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

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

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
- Creation committed but the saved state cannot be verified: `{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown" | "receipt-unknown", ...}`, **not retryable**; check by key/ref in Zotero;
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

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

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
- Committed but state unverified: `{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown" | "receipt-unknown", ...}`, **not retryable**;
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

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

### Example

```text
zotero_update_note(ref="zotero://user/0/item/NOTE1234", markdown="## Summary\n- first point")
```

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

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

### Example

```text
zotero_update_collection(collection="zotero://user/0/collection/COLL0001", name="Field notes (2026)")
```

---

## zotero_restore_items

Restore selected items from the personal library Trash. Each object's version is read and written to `deleted: 0` in dependency-ordered native batches (PATCH for a single object), success or failure is settled item by item, and one call takes at most 50 items.

### Parameters and output

| Parameter | Type     | Required | Description          |
| --------- | -------- | -------- | -------------------- |
| `refs`    | string[] | ✓        | Item refs to restore |

Output is `{kind: "restored", restored, unverified, failed, serverId?}`; version conflicts are recorded in `failed`, and unknown receipts in `unverified`.

Child notes, child attachments, and annotations are supported. The result body lists every restored object's ref, version, and library version, plus every failed or unverified object's ref and error details; the card reports restored, unverified, and failed counts. An unverified receipt must be reconciled by ref/key before any further action and is never retried.

An unapproved request returns `{kind: "declined"}` without writing.

### Example

```text
zotero_restore_items(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"])
```

---

## zotero_create_saved_search

Create a Zotero saved search with explicit conditions in the personal library. Creation requires at least one condition; when the create response is lost or its saved state cannot be verified, the result is `committed-unverified` (`retryable: false`), which must be reconciled by search ref/key before any retry.

### Parameters

| Parameter    | Type     | Required | Description                                                                             |
| ------------ | -------- | -------- | --------------------------------------------------------------------------------------- |
| `name`       | string   | ✓        | Name of the saved search (non-blank text)                                               |
| `conditions` | object[] | ✓        | List of condition objects, each containing `condition` (field), `operator`, and `value` |

### Output

- Successfully created: `{kind: "applied", ref, key, version, name, conditions, libraryVersion, serverId?}`;
- Unverified commit: `{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`;
- Declined on plan card: `{kind: "declined"}`.

### Example

```text
zotero_create_saved_search(name="Recent ML Papers", conditions=[{"condition": "itemType", "operator": "is", "value": "journalArticle"}])
```

---

## zotero_update_saved_search

Update the name or search conditions of an existing saved search in the personal library. Updates use an object-version precondition. A supplied `conditions` array must contain at least one condition.

### Parameters

| Parameter    | Type     | Required | Description                                                                                 |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `search`     | string   | ✓        | Target saved search ref (`zotero://user/0/search/<KEY>`)                                    |
| `name`       | string   | —        | New name (optional; non-blank text when provided)                                           |
| `conditions` | object[] | —        | New condition objects list (optional; each containing `condition`, `operator`, and `value`) |

At least one of `name` or `conditions` must be provided.

### Output

- Successfully updated: `{kind: "applied", ref, key, version, name?, conditions?, libraryVersion, serverId?}`;
- Unverified commit: `{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`;
- Declined on plan card: `{kind: "declined"}`.

### Example

```text
zotero_update_saved_search(search="zotero://user/0/search/SRCH1234", name="Updated ML Papers")
```

---

## zotero_delete_saved_search

Delete a saved search from the personal library. **Irreversible**: removes the saved-search definition only; library items are not affected. Deletion uses a library-version precondition.

### Parameters

| Parameter | Type   | Required | Description                                              |
| --------- | ------ | -------- | -------------------------------------------------------- |
| `search`  | string | ✓        | Target saved search ref (`zotero://user/0/search/<KEY>`) |

### Output

- Successfully deleted: `{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`;
- Unverified commit: `{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`;
- Declined on plan card: `{kind: "declined"}`.

### Example

```text
zotero_delete_saved_search(search="zotero://user/0/search/SRCH1234")
```

## scholarly_save_to_zotero

### Parameters

| Parameter          | Type     | Required | Description                                                             |
| ------------------ | -------- | -------- | ----------------------------------------------------------------------- |
| `itemType`         | string   | —        | Defaults to `journalArticle`; accepts the core create tool's item types |
| `title`            | string   | ✓        | Paper title                                                             |
| `authors`          | string[] | —        | Author names                                                            |
| `year`             | integer  | —        | Publication year                                                        |
| `doi`              | string   | —        | DOI                                                                     |
| `url`              | string   | —        | Publication URL                                                         |
| `abstract`         | string   | —        | Abstract (core batch create uses `abstractNote` instead)                |
| `publicationTitle` | string   | —        | Journal or conference name                                              |
| `tags`             | string[] | —        | Tags to add on creation                                                 |
| `collections`      | string[] | —        | Destination collection refs or exact names                              |

The tool enters the model's tool set only while the local Zotero component is mounted and `writeEnabled=true`.

Save scholarly search results into the personal library through the local write approval flow. The output is a union of `declined`, `applied`, and `committed-unverified`. Only `applied` carries the successfully saved `papers`, with the created items' ref, key, version, tags, collections, and library version; unverified results keep their original identity and reason and must not be retried. The card and conversation replay tell the three outcomes apart from the persisted content and state metadata.

#### Example

```text
scholarly_save_to_zotero(itemType="journalArticle", title="Attention Is All You Need", doi="10.48550/arXiv.1706.03762")
```

---

## zotero_update_item

Correct an item's scalar metadata. Field validity follows Zotero's `itemTypeFields`: a field the item type does not accept is refused before any PATCH, and values must be non-blank text. The write carries the item's version precondition (`If-Unmodified-Since-Version`).

Scalar updates validate every requested field against the item type, compare normalized wire values strictly, and PATCH only differences. A satisfied request returns `{kind: "applied", unchanged: true, changed: []}` with the observed item `version`, no new `libraryVersion`, and obtains no write key. Capability and both approval gates still apply.

### Parameters

| Parameter | Type   | Required | Description                                                                                 |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `ref`     | string | ✓        | Target item ref (`zotero://user/0/item/<KEY>`)                                              |
| `set`     | object | ✓        | At least one of: `title`, `date`, `url`, `doi`, `abstractNote`, `publicationTitle`, `extra` |

### Output

- Something changed: `{kind: "applied", ref, version, changed, libraryVersion, serverId?}` (`changed` lists the submitted field names in lexical order);
- Unchanged: `{kind: "applied", unchanged: true, changed: []}`;
- Declined on the plan card: `{kind: "declined"}`;
- Version precondition lost: `ZOTERO_WRITE_CONFLICT`. The object was changed concurrently; run the tool once more (the re-run reads the version again).

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

### Example

```text
zotero_update_item(ref="zotero://user/0/item/ABCD1234", set={"title": "Attention Is All You Need (2017)", "doi": "10.48550/arXiv.1706.03762"})
```

---

## zotero_delete_library_tags

Delete tags by name across the whole library. **Irreversible**: the tags come off every item in the library. The plan card pages through the tag list and shows known counts, unknown counts or proven absent names. Before deletion, the domain scans the tags again under one library version and refuses a changing snapshot. Only confirmed present names are submitted. Unverified outcomes require reconciliation and must not be retried.

### Parameters

| Parameter | Type     | Required | Description                                                                    |
| --------- | -------- | -------- | ------------------------------------------------------------------------------ |
| `tags`    | string[] | ✓        | Tag names to delete (1..`writeListMaxItems`, with a server cap of 50 per call) |

### Output

- Deleted: `{kind: "deleted", deletedTags, absentTags?, libraryVersion, serverId?}` (`deletedTags` contains only names confirmed present and submitted for deletion, sorted by name; `absentTags` reports proven no-ops separately. An all-absent selection sends neither a write nor an authorization request);
- Declined on the plan card: `{kind: "declined"}`.

An unverifiable submitted write returns `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`. Treat it as committed and reconcile it in Zotero; do not retry.

### Example

```text
zotero_delete_library_tags(tags=["stale", "obsolete"])
```

---

## zotero_batch_items

Create items, update tags and collection membership, or move items with their child notes, attachments, and annotations to the trash in one call. Item deletion writes each dependency layer with per-object versions in native batches (PATCH for a single object), then reads the graph back to verify it; when part of the graph fails, `failed.completedRefs` lists acknowledged objects. Trashed items can be restored from the Zotero trash. Operations merge into one plan review card listing all requested fields and collection memberships. Each operation runs independently, so a batch may complete only partly. Reconcile the result item by item from the receipts.

The total number of operations in one call (create, update, and delete combined) is bounded by `writeListMaxItems` (default 50). Each created item's receipt lists its saved ref, key, version, and available title/URL by input index. When an item's commit or saved state cannot be verified, it appears in `unverified` with `retryable: false` and should be reconciled by ref/key. Malformed or out-of-bounds batch indexes report as unverified results. A single-item version conflict (HTTP 412) is recorded in `failed` without affecting other items.

### Parameters

| Parameter | Type     | Required | Description                                                                                                                             |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | object[] | none     | Items to create. Each has `itemType` (required), `title` or `url`, and optionally `tags`, `collections`, `creators`, and similar fields |
| `update`  | object[] | none     | Items to update. Each has `ref` (required), and optionally `addTags`, `removeTags`, `addCollections`, `removeCollections`               |
| `delete`  | string[] | none     | Item refs to move to the trash (`zotero://user/0/item/<KEY>`)                                                                           |

At least one of `create`, `update`, or `delete` must be given, and the total count must not exceed the cap.

### Output

- Batch result: `{kind: "applied" | "partial" | "failed", total, created: [...], updated: [...], deleted: [...], unverified: [...], failed: [...], libraryVersion?, serverId?}`;
  - `kind: "partial"` means some operations completed while the rest failed or remain unverified; `kind: "failed"` means every operation failed.
  - `created`: `[{index, ref, key, version, itemType, title?, url?}]`, with fields taken from the object Zotero saved;
  - `updated`: `[{ref, unchanged, addedTags, removedTags, addedCollections, removedCollections}]`
  - `deleted`: `[{ref, key, deleted: true, version, children: [ref...]}]`, listing the root items verified into the trash together with all descendants;
  - `unverified`: `[{op: "create" | "update" | "delete", index, committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}]`;
  - `failed`: `[{op, index?, ref?, code, message, completedRefs?}]`, recording an item-level failure; when a deletion completes only partly, `completedRefs` lists the objects confirmed in the trash;
- Declined on the plan card: `{kind: "declined"}`.

### Example

```text
zotero_batch_items(
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
   - Plan review card: shows every supplied field and the complete note body. Authored values are rendered as literal text or fenced payloads, keeping their Markdown separate from plan instructions. Execution starts after confirmation; an unapproved request returns `{kind: "declined"}`. The plan body uses only the Markdown subset the host renderer supports.
2. Local API authentication:
   - A write must carry an API key issued by local Zotero;
   - Without a reusable grant, each request needs confirmation in Zotero's local authorization dialog (Allow once, Always Allow, or Decline). Multiple independent item updates share native batches of at most 50; Trash and restore batches follow child-to-parent dependencies. A single-use grant belongs exclusively to one request. Prompts share a rolling budget of five per minute and wait cancellably for capacity;
   - With `writePersistKey` on, the persistent key issued by Always Allow is stored safely in the host credentials manager; the settings page's "General → Writing" group can revoke it, and the next write asks again.
   - An approved operation has one 15-minute deadline, including the operation queue, authorization, writes and verification. The full read-modify-write cycle is serialized across transport rebuilds. Revocation atomically removes the stored secret; commit-unknown results retain their reconciliation status on cancellation.
3. Shell write detection (turned into one approval):
   - A listener detects write commands aimed at the local API and turns each one into a Harness approval request before the command runs, so an unauthorized script cannot modify the library unasked. This is best-effort, not a boundary.

   Detection reads command text only and cannot cover every path. These paths are not detected:
   - writing a request into a script file and then running it (`bash build.sh`);
   - an interpreter call whose command text does not spell the endpoint (URLs assembled at runtime in `python -c '...'` or `node -e '...'`); an interpreter call that spells the endpoint in its command text is still detected;
   - a URL hidden in an environment variable, a heredoc, or an encoding;
   - a loopback port other than the configured one (exception: write requests to `/api/users/` and authorize calls are detected on any loopback port);
   - a `run_code` program that constructs a request at runtime, outside shell-text inspection;
   - any binary of the user's own.

   The system prompt keeps the model on the write tools, and shell writes that bypass them are gated by the approval this detection raises. To make the library entirely unreachable from the shell, run the session without an unconstrained shell: use `tools.restrict({ deny: ["bash"] })` per agent, or a preset without a shell. A raw write that is confirmed and allowed runs outside the plugin's write domain, so it has no plan card, version precondition, Markdown-to-note HTML conversion, or provenance. The confirmation accepts that scope.

---

## Error codes

| Error code                                 | Description                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ZOTERO_NOT_RUNNING`                       | Zotero is not running or the local port is unreachable                                                                                 |
| `ZOTERO_API_DISABLED`                      | Zotero is running but the local API is not enabled in advanced settings (403)                                                          |
| `ZOTERO_API_VERSION`                       | Unsupported local API version                                                                                                          |
| `ZOTERO_NOT_IMPLEMENTED`                   | The local API explicitly returns 501; endpoint or format unimplemented in this version                                                 |
| `ZOTERO_SERVER_MISMATCH`                   | Referenced Server ID does not match the running Zotero instance                                                                        |
| `ZOTERO_NOT_FOUND`                         | Referenced item, collection, or saved search does not exist                                                                            |
| `ZOTERO_RANGE_UNSUPPORTED`                 | The server does not keep change history back to the requested version (409)                                                            |
| `ZOTERO_NO_ATTACHMENT`                     | No attachment of the requested type exists under the item                                                                              |
| `ZOTERO_NO_FULLTEXT`                       | The attachment has no full-text index                                                                                                  |
| `ZOTERO_SOURCE_PAGE_STALE`                 | The literature trail changed while paging; the page coordinates (offset + revision) are stale (refresh and page again)                 |
| `ZOTERO_URL_PDF_DISABLED`                  | URL PDF reading is not authorized in the literature panel settings                                                                     |
| `ZOTERO_URL_PDF_BUSY`                      | Two URL PDF downloads are already running (literature panel endpoint)                                                                  |
| `ZOTERO_URL_PDF_NOT_URL`                   | The attachment is not a URL PDF (literature panel endpoint)                                                                            |
| `ZOTERO_URL_PDF_REDIRECT`                  | PDF redirect limit exceeded, Location missing, or an HTTPS downgrade (literature panel endpoint)                                       |
| `ZOTERO_URL_PDF_HTTP`                      | The PDF source returned a non-success status (literature panel endpoint)                                                               |
| `ZOTERO_URL_PDF_NOT_PDF`                   | The response is not a PDF: media type or file signature mismatch (literature panel endpoint)                                           |
| `ZOTERO_URL_PDF_TIMEOUT`                   | The PDF download exceeded 60 seconds (literature panel endpoint)                                                                       |
| `ZOTERO_URL_PDF_FORBIDDEN_TARGET`          | The PDF address failed the public-address check (loopback, private, or reserved) (literature panel endpoint)                           |
| `ZOTERO_URL_PDF_TOO_LARGE`                 | The PDF exceeds the 32 MiB reading limit (literature panel endpoint)                                                                   |
| `ZOTERO_URL_PDF_NETWORK`                   | The PDF download failed at the transport layer; the raw URL is never surfaced (literature panel endpoint)                              |
| `ZOTERO_FILE_MISSING`                      | The recorded local attachment file does not exist on disk                                                                              |
| `ZOTERO_FILE_UNREADABLE`                   | The local attachment path cannot be resolved or the file is unreadable (`zotero_get` with `locations` reports it as `location.reason`) |
| `ZOTERO_INVALID_REF`                       | Ref format violates the `zotero://` grammar or targets an unsupported library                                                          |
| `ZOTERO_INVALID_ARGUMENT`                  | Argument violates domain constraints                                                                                                   |
| `ZOTERO_SCOPE_AMBIGUOUS`                   | A collection or saved-search name matches several same-name objects                                                                    |
| `ZOTERO_TIMEOUT`                           | Provider request timed out                                                                                                             |
| `ZOTERO_RESPONSE_TOO_LARGE`                | API response stream exceeds the read cap                                                                                               |
| `ZOTERO_OUTPUT_TOO_LARGE`                  | Export content exceeds the character cap                                                                                               |
| `ZOTERO_CAPABILITY_UNAVAILABLE`            | The current provider does not declare the required capability                                                                          |
| `ZOTERO_SCHOLARLY_NO_FULLTEXT`             | Scholarly full-text resolution found no readable copy, with route failure details in the error message                                 |
| `ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE` | A scholarly credential reference is configured but no credentials service is mounted                                                   |
| `ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED`   | A configured scholarly credential reference is invalid or has no value                                                                 |
| `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`  | The configured MinerU token reference cannot be resolved                                                                               |
| `ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE`       | Explicit parsing needs session-owned `ctx.jobs` and a live session controller, which are unavailable                                   |
| `ZOTERO_ENRICHMENT_OPERATION_CONFLICT`     | An operation id was replayed with a different target or settings snapshot                                                              |
| `ZOTERO_ENRICHMENT_TASK_FAILED`            | MinerU reported the parsing task as failed, with its own stated reason                                                                 |
| `ZOTERO_ENRICHMENT_OUTPUT_INVALID`         | The parsed-artifact output directory failed validation                                                                                 |
| `ZOTERO_ENRICHMENT_ARCHIVE_INVALID`        | The MinerU archive failed structural or zip-safety validation                                                                          |
| `ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT`      | The document exceeded the selected API's size limit or is not a PDF                                                                    |
| `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`   | Semantic search is enabled but the model is missing, corrupt, or runtime inference failed                                              |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED`  | The local semantic model download failed after every source was tried                                                                  |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT` | The local semantic model download exceeded its overall deadline                                                                        |
| `ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED`    | The local semantic model could not be removed, or its path failed the safety checks                                                    |
| `ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND`     | The parsed artifact id names no committed artifact                                                                                     |
| `ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED` | The parsed artifact cleanup failed, or its path failed the safety checks                                                               |
| `ZOTERO_JOBS_LIMIT_REACHED`                | Parse endpoint: the session already holds its maximum background parse jobs; collect or cancel one before retrying                     |
| `ZOTERO_PROVIDER_UNAVAILABLE`              | The configured provider is not registered or the method is unimplemented                                                               |
| `ZOTERO_UNEXPECTED`                        | Abnormal response payload or unexpected behavior                                                                                       |
| `ZOTERO_WRITE_UNAUTHORIZED`                | Write not authorized: key missing, expired, or rejected in the authorization dialog                                                    |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE`        | The plan review card cannot start interaction (no interactive channel or a system-level failure)                                       |
| `ZOTERO_WRITE_CONFLICT`                    | Write version precondition conflict (412); the object was modified externally                                                          |
| `ZOTERO_WRITE_RATE_LIMITED`                | Zotero authorization or data write request rate limited (429)                                                                          |

---

## Status codes

These values are warnings in status views, not tool errors:

| Status code                       | Meaning                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ZOTERO_SOURCE_PROJECTION_FAILED` | The full literature-trail projection failed to register; the panel degrades and local reads remain available. |

## Scholarly literature retrieval component tools (`dsh-zotero/scholarly`)

The bundle component `dsh-zotero/scholarly` ships with the package and is off by default. Enabling it under "Included components" in the plugin manager mounts it and provides 7 model tools: the first 6 are retrieval, reading, and verification tools (detailed below), and the 7th is the library write tool [`scholarly_save_to_zotero`](#scholarly_save_to_zotero) (detailed above under [write tools](#scholarly_save_to_zotero)):

`scholarly_search`, `scholarly_read`, and `scholarly_verify` also declare `run_in_background`: a result is either plain text or one of the two job arms `{ kind: "background", jobId }` / `{ kind: "promoted", jobId, timeoutMs, message }`; collect it with `job_output` and cancel it with `job_kill`. An explicit background request is refused with a structured error while `enableRunInBackground=false` or when no `jobs` service is mounted; a foreground wait that exceeds `foregroundWaitMs` is promoted when `promoteOnTimeout=true`, and the job result text is served from `JobOutcome.result`.

### scholarly_search

Multi-source literature retrieval across arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP. It supports phrase-based topic routing and multi-source RRF fusion with deduplication, and checks the local Zotero library for saved status automatically.

#### Parameters

| Parameter           | Type     | Default       | Description                                                                                                                                                                                                                                     |
| ------------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`             | string   | required      | Topic words, paper title, or author name                                                                                                                                                                                                        |
| `sources`           | string[] | none          | Optional source filter (`arxiv`, `openalex`, `crossref`, `semanticscholar`, `pubmed`, `europepmc`, `dblp`); by default routed automatically by the topic phrase table                                                                           |
| `year_from`         | integer  | none          | Start publication year; with `sort="date"` and this omitted, only the previous year is used by default                                                                                                                                          |
| `year_to`           | integer  | none          | End publication year                                                                                                                                                                                                                            |
| `open_access`       | boolean  | none          | Whether to return only papers with free open-access full text                                                                                                                                                                                   |
| `sort`              | string   | `"relevance"` | Sort order: `relevance`, `date` (newest first; only the previous year when `year_from` is omitted), `citations` (most cited first)                                                                                                              |
| `categories`        | string[] | none          | arXiv category filter (such as `cs.CL`, `stat.ML`)                                                                                                                                                                                              |
| `limit`             | integer  | `8`           | Paper cap                                                                                                                                                                                                                                       |
| `abstract`          | string   | `"snippet"`   | Abstract verbosity: `none`, `snippet`, `full`                                                                                                                                                                                                   |
| `run_in_background` | boolean  | `false`       | Whether to start as a background job (managed by the Harness `ctx.jobs` under the `scholarly` job kind; declared only while `enableRunInBackground=true` and the host mounts `jobs`, and passing `true` otherwise returns a structured refusal) |

#### Example

```text
scholarly_search(query="transformer attention", limit=5)
```

---

### scholarly_get

Aggregate the complete scholarly graph metadata of one paper by DOI, arXiv ID, PMID, PMCID, URL, or exact title (authors, venue, abstract, citation count, open-access full-text link, and local Zotero library match status).

#### Parameters

| Parameter | Type   | Default  | Description                                                                                           |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `id`      | string | required | DOI (such as `10.1038/nature1234`), arXiv ID (such as `2301.07041`), PMID, PMCID, URL, or exact title |

#### Example

```text
scholarly_get(id="10.1038/nature1234")
```

#### Failure semantics

When an index cannot answer (rate limited, timed out, service error), the result lists it as `Unanswered sources: <index> (<reason>)`, and successful hits carry `Notice: <index> (<reason>)`. The reason carries the underlying transport code (such as `fetch failed (UND_ERR_INVALID_ARG)` or `fetch failed (ECONNRESET)`), so a local composition error is distinguishable from a network failure. An unavailable index does not mean the paper does not exist: only when every index answered normally and none matched does the tool ask the caller to check the identifier.

---

### scholarly_citations

Trace a paper's citation graph: the list of papers citing this work (citations), this paper's reference list (references), or semantically related papers (related).

#### Parameters

| Parameter   | Type    | Default  | Description                                                                                                                              |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string  | required | DOI, arXiv ID, or PMID                                                                                                                   |
| `direction` | string  | required | Trace direction: `citations` (papers citing this paper), `references` (papers this paper cites), `related` (semantically related papers) |
| `limit`     | integer | `10`     | Paper cap                                                                                                                                |

#### Example

```text
scholarly_citations(id="2301.07041", direction="citations", limit=5)
```

---

### scholarly_read

Tiered reading of lawful open-access full text with passage-level evidence location. Supports outline extraction (`outline`), section-targeted reading (`section`), and evidence-passage matching from a natural-language question (`query`).

#### Parameters

| Parameter           | Type     | Default    | Description                                                                                                                                                                                                                                     |
| ------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string   | required   | arXiv ID, DOI, PMID, PMCID, or a direct PDF link                                                                                                                                                                                                |
| `outline`           | boolean  | none       | Set to `true` to return only the multi-level outline and character spans                                                                                                                                                                        |
| `section`           | string   | none       | Section number or title to read closely (such as `"2"` or `"Methodology"`)                                                                                                                                                                      |
| `query`             | string   | none       | Natural-language question; passages are ranked over the full text with the same strategy and the same chunk boundaries as `zotero_retrieve` Each query is limited to 2,000 characters; longer input is refused before reading.                  |
| `queryVariants`     | string[] | none       | Other phrasings of the same question (synonyms, field terminology), at most 4; each is limited to 2,000 characters. Each is ranked separately and a passage keeps its best score.                                                               |
| `passages`          | integer  | `5`        | Number of top passages returned in `query` mode (1-12)                                                                                                                                                                                          |
| `start`             | integer  | `0`        | Starting character offset for chunked reading                                                                                                                                                                                                   |
| `max_chars`         | integer  | config cap | Maximum characters read per call                                                                                                                                                                                                                |
| `run_in_background` | boolean  | `false`    | Whether to start as a background job (managed by the Harness `ctx.jobs` under the `scholarly` job kind; declared only while `enableRunInBackground=true` and the host mounts `jobs`, and passing `true` otherwise returns a structured refusal) |

#### Example

```text
scholarly_read(id="2301.07041", query="attention mechanism")
```

#### Network boundary

The retrieval tools (`scholarly_search` / `scholarly_get` / `scholarly_citations` / `scholarly_verify`) reach only the fixed scholarly-index host allowlist (`src/scholarly/transport/hosts.ts`); the allowlist arm is HTTPS-only and applies the two-gate public-address check at every hop (lexical gate plus connect-time resolution and pinning), refusing loopback, private, and other non-public addresses. Full-text resolution is the exception: open-access PDFs and direct PDF links live on the publisher's own domains, so that path **does not apply the host allowlist** but still checks at every hop that the answer is a public address (loopback and private answers are refused), following at most 5 redirects. Behind a local fake-IP proxy, allowlisted index hosts and HTTPS fulltext targets accept the `198.18.0.0/15` placeholder (identity bound by the reviewed hostname and TLS); a plain-HTTP fulltext target still requires a validated public address and cannot use the placeholder. The URL passed as `id`, and any PDF address it resolves to, may therefore be any public host, so read only literature links from sources you trust.

---

### scholarly_cite

Fetch standard citation formats directly from the official DOI registration agencies (Crossref, DataCite) through content negotiation.

#### Parameters

| Parameter | Type     | Default  | Description                                                                                                           |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ids`     | string[] | required | DOI, arXiv ID, or PMID list (at most 30 papers per call; exceeding this returns an error)                             |
| `format`  | string   | required | Citation format: `bibtex`, `ris`, `csljson`, `text` (formatted reference)                                             |
| `style`   | string   | `"apa"`  | CSL style ID when `format="text"` (such as `apa`, `ieee`, `nature`, `china-national-standard-gb-t-7714-2015-numeric`) |
| `locale`  | string   | none     | Language code (such as `zh-CN`, `en-US`)                                                                              |

#### Example

```text
scholarly_cite(ids=["10.1038/nature1234"], format="bibtex")
```

---

### scholarly_verify

Reference truthfulness and accuracy verification. Parses the authors, year, title, and DOI from reference text and compares them field by field against the official Crossref registry, catching fabricated references, mismatched DOIs, wrong years, and retraction status.

#### Parameters

| Parameter           | Type     | Default  | Description                                                                                                                                                                                                                                     |
| ------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references`        | string[] | required | Reference text list to verify (at most 40 papers per call; exceeding this returns an error)                                                                                                                                                     |
| `run_in_background` | boolean  | `false`  | Whether to start as a background job (managed by the Harness `ctx.jobs` under the `scholarly` job kind; declared only while `enableRunInBackground=true` and the host mounts `jobs`, and passing `true` otherwise returns a structured refusal) |

#### Verdicts

Each reference returns one of four verdicts: `VERIFIED` (the registry record exists and every compared field agrees), `CHECK` (the record exists but a field differs or the work is retracted), `NOT FOUND` (the registry answered and holds no such record), `UNVERIFIED` (the registry was unreachable, so nothing is concluded about this entry). When the registry cannot be reached, the verdict is `UNVERIFIED`.

#### Example

```text
scholarly_verify(references=["Vaswani et al. 2017, Attention Is All You Need"])
```
