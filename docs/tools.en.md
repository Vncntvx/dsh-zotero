<p align="right"><a href="tools.md"><b>中文</b></a></p>

# dsh-zotero Tool Reference

dsh-zotero registers 11 tools that operate on the user's library through the local Zotero HTTP API (the three write tools register only while `writeEnabled` is on in the settings; they are off by default). All refs are stable identifiers in `zotero://user/0/item/<KEY>` (personal) or `zotero://group/<ID>/item/<KEY>` (group) format; personal is always `user/0` canonical.

---

## zotero_search

Discover candidate entries in the library. Metadata mode searches title/author/year; everything mode also searches the full-text index.

### Parameters

| Parameter        | Type                           | Default             | Description                                                                                               |
| ---------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `query`          | string                         | —                   | Free-text query; omit to browse the full library                                                          |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | Search scope                                                                                              |
| `scope`          | object                         | `{kind: "library"}` | `{kind:"library"}` / `{kind:"collection", refOrName}` / `{kind:"savedSearch", refOrName}`                 |
| `library`        | object                         | —                   | Library: `{type:"user",id:0}` or `{type:"group",id}`; for name scopes selects library, for ref must match |
| `itemTypes`      | string[]                       | —                   | Zotero item type names (e.g. `journalArticle`), OR combined                                               |
| `tags`           | string[]                       | —                   | Tag names, `tagMatch` controls AND/OR                                                                     |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | How multiple tags combine                                                                                 |
| `excludeTags`    | string[]                       | —                   | Tags to exclude (NOT)                                                                                     |
| `includeTrashed` | boolean                        | `false`             | Include trashed items (only with `library` scope)                                                         |
| `sort`           | string                         | `"dateModified"`    | Sort field: `dateModified` / `dateAdded` / `date` / `title` / `creator`                                   |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | Sort direction                                                                                            |
| `offset`         | integer                        | `0`                 | Pagination offset                                                                                         |
| `limit`          | integer                        | `10`                | Max return count (capped by `maxSearchResults`, default 20)                                               |

### Output

`scope` (library scopes include `library` for pagination replay), `items` (primary hits only: ref, title, creatorSummary, year, itemType, bestAttachmentRef, bestAttachmentType), `total`, `offset`, `returned`, `nextOffset`, `supplemental` (optional: `{kind:"noteBody", items, scanned, truncated}`)

### Notes

On the first query (offset 0) with a `library`/`collection` scope (saved searches never scan), the client scans note bodies and lists the matches in `supplemental.items` (ordered by dateModified desc, filling only the page's unused headroom, capped by `maxNoteScanRecords`). `items`/`total`/`returned`/`nextOffset` describe the primary result set alone, so `returned` never exceeds `total`; under a collection scope, child notes join through their parent item's membership (child notes carry no `collections` of their own). `tagMatch` requires `tags`; the call fails otherwise.

### Example

```
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

Read a single item's full metadata. By default returns only metadata; specifying `include` loads child content — `notes`/`attachments` from the bare `/children` listing (notes and attachments only), `annotations` from `/children?itemType=annotation`. Zotero's Local API never returns annotations from a bare children listing (they hang off PDF attachments).

### Parameters

| Parameter | Type                                        | Required | Description                    |
| --------- | ------------------------------------------- | -------- | ------------------------------ |
| `ref`     | string                                      | ✓        | Item ref                       |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —        | Child content types to include |

### Output

`ref`, `itemType`, `title`, `creators`, `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`, `noteBody` (note items), `tags`, `collections`, `children`, `bestAttachment`, `relations` (as `dc:relation` etc, `targetRef` only when provably local), plus requested `notes`/`annotations`/`attachments` (with total, returned, items)

### Example

```
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

Collect and query-rank evidence passages for a single item. Sources include: Zotero annotations (with page labels), notes, abstract, and full-text chunks (BM25 ranked).

### Parameters

| Parameter          | Type     | Default | Description                                                           |
| ------------------ | -------- | ------- | --------------------------------------------------------------------- |
| `ref`              | string   | —       | Item ref (required)                                                   |
| `query`            | string   | —       | Query terms for ranking evidence (required)                           |
| `sources`          | string[] | All 4   | `annotation` / `note` / `abstract` / `fulltext`                       |
| `passages`         | integer  | `4`     | Max return passage count (capped by `maxEvidencePassages`, default 4) |
| `attachmentPolicy` | string   | `best`  | Full-text source: `best` / `allIndexed` / `specified`                 |
| `attachmentRefs`   | string[] | —       | Required for `specified`: the attachment refs entering the ranking    |

### Output

`ref`, `attachmentRef`, `attachmentContentType`, `coverage` (indexedChars/totalChars/complete etc.), `attachments` (per-source facts under the multi-attachment policies), `evidence` (source, sourceRef, text, chunkIndex, chunkCount, comment, pageLabel, matchedFields), `truncated`, `sourcesSkipped`

### Notes

- Only Zotero annotations carry page labels; full-text passages never have fabricated page numbers
- Unavailable sources are skipped and reported in `sourcesSkipped`
- Only `annotation` sources have `pageLabel`; full-text passages never carry page numbers
- `truncated` true means more evidence was cut off: a passage over the passage-count or character budget is omitted whole, never edited. The budget charges what the model actually reads — the passage text plus, for an annotation, its comment
- Every `attachmentPolicy="specified"` attachment must be provably this item's own: its `parentItem` names `ref`, its library and Zotero instance match, and the answer really says `itemType: "attachment"`. If any of that cannot be proven the call fails — a same-key object from another item, another library, or another instance never substitutes for the named one
- A repeated ref is read once; one call ranks at most 16 attachments and fails rather than silently dropping the rest (split the work across calls)
- To gather evidence from another item, call `zotero_retrieve` for that item instead of attaching its files to this item's evidence
- Ranking tokens are folded exactly as Zotero's own search folds text (diacritics, typographic quotes and dashes, NFKD decomposition), so `cafe` matches `café` in a passage; the passage text returned is always the original
- An annotation ranks on its highlight and its reader comment together, so a comment-only annotation (no selected text) is still findable. `matchedFields` says whether the match came from `text` or `comment`, and a comment-only hit states plainly that those are the annotator's words rather than the paper's text; single-text sources carry no such field
- Under the multi-attachment policies (`allIndexed` / `specified`) `attachments` lists every full-text source the call actually considered: `indexed` (full text read, with `coverage`, `passages`, and whether the character budget cut it), `unindexed` (Zotero's index has no text for that file), `unread` (not read — the call was already at its attachment limit). An unindexed supplement therefore reads as a named gap, never as "the supplement says nothing"
- `maxFulltextChars` is the whole call's full-text input budget, shared evenly across the attachments it reads: a single source gets all of it, several are each cut to their share, reported per file in `attachments[].inputTruncated` and once in `truncated`. One call reads at most 16 attachments (see above)

### Example

```
zotero_retrieve(ref="zotero://user/0/item/ABC123", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_attachment

Resolve a ref to an accessible attachment location. Accepts an item ref (auto-picks best attachment) or an attachment ref (exact target).

### Parameters

| Parameter | Type   | Required | Description                |
| --------- | ------ | -------- | -------------------------- |
| `ref`     | string | ✓        | Item ref or attachment ref |

### Output

Discriminated union type:

- `{kind: "file", path, ref, title, contentType}` — local file (verified to exist via async stat). The path belongs to the machine running Zotero; a caller whose file access runs in a sandbox, a container, or on a remote host may not see it, and the rendered answer states that environment
- `{kind: "url", url, ref, title, contentType}` — linked attachment

Item refs follow Zotero's best-attachment link first, falling back to the earliest PDF child.

### Example

```
zotero_attachment(ref="zotero://user/0/item/ABC123")
```

---

## zotero_export

Generate citations or formatted exports.

### Parameters

| Parameter | Type     | Default   | Description                                                                        |
| --------- | -------- | --------- | ---------------------------------------------------------------------------------- |
| `refs`    | string[] | —         | Item ref list (required), capped by `maxExportRefs` (default 50)                   |
| `format`  | string   | —         | `citation` / `bibliography` / `bibtex` / `biblatex` / `ris` / `csljson` (required) |
| `style`   | string   | Config    | CSL style ID (citation/bibliography only)                                          |
| `locale`  | string   | `"en-US"` | CSL locale (citation/bibliography only)                                            |

### Output

| Format                              | Output structure                                             |
| ----------------------------------- | ------------------------------------------------------------ |
| `citation`                          | `{citations: [{ref, text}]}`                                 |
| `bibliography`                      | `{text}`                                                     |
| `bibtex`/`biblatex`/`ris`/`csljson` | `{text, items: [{ref, key, title, entryIndex, start, end}]}` |

### Notes

- `citation` mode auto-batches requests per Zotero's 50-key limit
- `bibtex`/`biblatex`/`ris`/`csljson` accept up to 50 items per call; split larger sets into batches
- Export text is never truncated — exceeding `maxExportChars` (default 1M) raises an error
- One export call allows refs from only one `library`; mixing `user/0` and `group` (or different groups) raises `INVALID_ARGUMENT` with 0 HTTP

### Example

```
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
```

---

## zotero_browse

Discover library structure. Every `kind` pages with `offset/limit` (default `20`, capped by `maxBrowseResults` at 50) and returns `total/returned/nextOffset`.

Pagination honesty applies uniformly: `zotero_search` and `zotero_browse` array listings require a valid `Total-Results` header and fail the whole call with `ZOTERO_UNEXPECTED` without it, instead of guessing totals from body length. `zotero_changes` takes a different route: it reads each resource whole (no `limit` — the local API answers an unbounded request in full; the item kind is three whole reads, `/items`, `/items/top` and `/items/trash`) and, when `Total-Results` is present, compares it against the map key count to decide whether that read was whole; without the header it trusts the unbounded request to be complete. The listing itself is capped at `maxChangesResults`, with the true counts in `totals`; the render hands the model that whole listing — there is no second cut — so entries beyond the cap are reached by raising `maxChangesResults`, not by re-running with another parameter. A body that is not a key→version map (an array, a string, a value that is not a non-negative integer) is never read as "nothing changed": the kind is recorded as unreadable (`unobservable` with reason `unreadable`) and withholds this call's cursor.

| Parameter | Type                                                                           | Default    | Description                                                 |
| --------- | ------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------- |
| `kind`    | `libraries`\|`collections`\|`savedSearches`\|`tags`\|`itemTypes`\|`itemFields` | —          | What to browse (`itemFields` requires `itemType`)           |
| `library` | object `{type, id}`                                                            | `user/0`   | Target library (valid for `collections/savedSearches/tags`) |
| `q`       | string                                                                         | —          | `tags` substring filter                                     |
| `match`   | `contains`\|`startsWith`                                                       | `contains` | How `q` matches tags (requires `q`)                         |
| `offset`  | integer                                                                        | `0`        | Pagination offset                                           |
| `limit`   | integer                                                                        | `20`       | Return cap                                                  |

### Output

- `libraries`: `{library, name}`
- `collections`: `{ref, name, parentRef?, path: string[], depth}` (full breadcrumb path)
- `savedSearches`: `{ref, name, conditions?}`
- `tags`: `{tag, count?}`
- `itemTypes`: `{itemType, localized?}`
- `itemFields`: `{field, localized?}` or `{creatorType, localized?}` for the given `itemType`

### Example

```
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_children

Explore one item's or attachment's child objects. An item ref: direct notes and attachments from bare `/children`; annotations (stored under PDF attachments, not the paper) only from `/children?itemType=annotation`. An attachment ref: that file's own annotations via the same filtered listing. Enumerate structure here before reading full metadata with `zotero_get`.

### Parameters

| Parameter | Type     | Required | Description                                                                                                       |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `ref`     | string   | ✓        | Item ref or attachment ref                                                                                        |
| `include` | string[] | —        | `notes` / `attachments` / `annotations` (omitted returns all three; an explicit empty array is an argument error) |

### Output

`{ref, itemType?, serverId?, notes?, attachments?, annotations?}`, each section a `{total, returned, items}` collection. Note items carry `parentRef` (the parent item ref that produced them).

### Example

```
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

See what changed in the library since a version. On the verified Zotero 10.0.2-beta.9, versions are local transaction versions — every object save advances the library counter and stamps the object (Zotero's `dataObject.js`, `_finalizeSave`), and a delete advances the counter alone. The plugin never guesses semantics from a Zotero version number: it decides per call from the responses themselves. No library version at all is reported as `versionUnavailable` (that build cannot be diffed), and a kind it could not read is named in `unobservable` with the reason. Call without `since` first for a baseline reading, which mints a **cursor**: the version together with the instance and library it belongs to. Pass that cursor back as `since` later.

**The item space is read as Zotero partitions it**: the `items` kind covers three endpoints — `/items/top` (top-level items), `/items` (all live items) and `/items/trash` (the trash) — reported as `changed.items`, `changed.childItems` and `changed.trashedItems`. Child objects (notes, attachments, annotations) are the difference between the two live reads: they carry versions of their own, so editing one annotation advances the library version without touching any top-level item, and a diff over `/items/top` alone would drop it in silence. Zotero's item listings exclude the trash as well, so without the trash read a move to the trash is invisible. When any of the three reads is unavailable the whole kind is reported as unobservable rather than a slice of the item space being presented as the item space.

**Cursor contract**: a returned `cursor` is safe by construction — it means this call read the whole changed set it reports and the library version did not move while it read, so it can be passed back as `since` directly. When the read was not whole (a build that caps the response) or a write landed mid-read (also flagged `libraryChanged: true`), no `cursor` is returned and the caller must not advance from that result. A cursor covers only the resource kinds the call that produced it included. Among `unobservable` reasons, `not-served` (the build has no such endpoint) and `range-not-covered` (the range is older than the history the build keeps) do **not** withhold the cursor — those changes were never observable in any range — while `unreadable` (the answer did not have the documented shape) does, because there the rows exist and this call failed to read them.

**How removals are read**: `deleted` present means observed — the four lists (`items`/`collections`/`savedSearches`/`tags`, the last holding tag names rather than keys) are always there when the read succeeded, and all four empty is the positive statement "nothing was removed in this range". When the endpoint answers 404 (Zotero 10.0.2-beta.9 has no `/deleted` route) or the payload is not the documented shape, `deleted` is absent as a whole and the kind is named in `unobservable` — "could not read" is never written as "nothing was deleted". Tombstone entries outside the documented four kinds (Zotero also syncs a settings list of its own) are counted in `totals.deletedOther`.

**A cursor carries its identity**: a version is one library's transaction counter, so the same integer means an unrelated counter in another Zotero instance or another library. The cursor therefore carries `serverId` and `library`, and a bare version number is not accepted. Used as `since`, that instance claim travels as the `Zotero-Server-ID` request header on every request; the server answers 412 for another database and the plugin reports `ZOTERO_SERVER_MISMATCH` — which holds after a client rebuild, a settings hot-reload or a host restart, because the check does not rely on plugin memory. A cursor whose library differs from the call's `library` is refused with `ZOTERO_INVALID_ARGUMENT` before any request.

**`fulltext` is not in the default set**: `/fulltext?since=` filters on `fulltextItems.version`, the full-text index's own counter (`fulltext_<libraryID>`, see Zotero's `fulltext.js`), not the library version. Verified against a live Zotero 10.0.2-beta.9: `since=0` and `since=<library version>` return the same rows, and the endpoint sends no version header at all. Those rows are therefore a listing rather than a delta on the library version, so they are read only when `fulltext` is named explicitly.

### Parameters

| Parameter | Type     | Default          | Description                                                                                                                                                                       |
| --------- | -------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library` | object   | —                | `{type, id}`; omitted defaults to personal `user/0`                                                                                                                               |
| `since`   | object   | —                | The cursor to diff from, `{serverId, library, version}`: pass an earlier result's `cursor` back verbatim; a bare version number is not accepted; omitted takes a baseline reading |
| `include` | string[] | all but fulltext | `items` (top-level items + child objects + trashed items, listed apart) / `collections` / `savedSearches` / `fulltext` / `deleted` (an explicit empty array is an argument error) |

### Output

`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed: {items?, childItems?, trashedItems?, collections?, savedSearches?, fulltextAttachments?}, deleted?: {items, collections, savedSearches, tags}, totals?, unobservable?: {kind, reason}[], truncated?}`. Each resource is read whole (the item kind is three whole reads, one per endpoint), but every listing is capped at `maxChangesResults` (default 50) with `truncated` marking it as a digest; `totals` reports the true counts per resource (including `childItems`/`trashedItems`/`deletedItems`/`deletedCollections`/`deletedSavedSearches`/`deletedTags`/`deletedOther`) before that cap — a count being present is the statement that the kind was read, so coverage never has to be guessed from whether a list is empty. Each `unobservable` entry carries its reason: `not-served` (the build has no such endpoint — e.g. Zotero 10.0.2-beta.9 has no `/deleted` route), `range-not-covered` (`since` is older than the delete log the build keeps; answered 409), `unreadable` (the response was not the documented shape, so this call could not read it and returns no cursor).

### Example

```
zotero_changes()
zotero_changes(since={serverId: "<from cursor>", library: {type: "user", id: 0}, version: 1234}, include=["items", "deleted"])
```

---

## zotero_create_note

Create a research note — standalone, or a child note under a parent item — with tags, collections, and source relations applied at creation. The plugin converts the markdown body to Zotero note HTML under a whitelisted grammar (paragraphs, headings to level four, bold/italic, inline and fenced code, quotes, one-level lists, pipe tables with a `---` separator row, links on `https://`/`http://`/`zotero://` only); **anything outside the grammar is escaped to literal text, and raw HTML never passes through**. Zotero's server converts nothing on write — markdown stored verbatim renders as raw markup, the failure mode community integrations hit — which is why the conversion lives in the plugin. Child notes inherit their parent item's collections; only standalone notes take `collections`. Sources are recorded as `dc:relation` links (Zotero's item relations), and the saved state comes back inside the batch's successful bucket, so no follow-up read is needed. Every write first shows a plan card for approval; Zotero 10 additionally shows its own authorization dialog on first use (Allow / Always Allow / Deny, Deny the default).

### Parameters

| Parameter     | Type     | Default | Description                                                                                     |
| ------------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `markdown`    | string   | —       | The note body (markdown, 65536-character bound)                                                 |
| `parentItem`  | string   | —       | Parent item ref; omit for a standalone note                                                     |
| `collections` | string[] | —       | Collection refs or exact names; standalone notes only — a child note plus this parameter errors |
| `tags`        | string[] | —       | Tags applied at creation                                                                        |
| `sourceRefs`  | string[] | —       | Source item refs, recorded as `dc:relation` links and echoed in the result                      |

### Output

`{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`; `kind: "declined"` means the user answered the plan card without approving — nothing was written. That is a normal outcome, not an error; do not retry.

### Example

```
zotero_create_note(markdown="**Methods**: see section 2.", parentItem="zotero://user/0/item/ABCD1234", tags=["review"], sourceRefs=["zotero://user/0/item/EFGH5678"])
```

---

## zotero_add_tags

Add tags to one item. Zotero's PATCH replaces arrays wholesale instead of merging, so the tool runs read-merge-write internally: it reads the item's tags and version, unions the additions (existing tags keep their colored/automatic types), and submits the merged list under `If-Unmodified-Since-Version`. When every requested tag is already present, **no write is sent at all** — the result reports `unchanged: true`. A lost precondition (the object changed after the read) fails as `ZOTERO_WRITE_CONFLICT`: re-run the tool once, and it re-reads and reapplies. Every write shows a plan card first.

### Parameters

| Parameter | Type     | Default | Description                                        |
| --------- | -------- | ------- | -------------------------------------------------- |
| `ref`     | string   | —       | The item ref to tag                                |
| `tags`    | string[] | —       | Tags to add (at least 1, at most 50; deduplicated) |

### Output

`{kind: "applied", ref, version, tags, added, unchanged, libraryVersion?, serverId?}`. `tags` is the full merged list; `added` is what this call added.

### Example

```
zotero_add_tags(ref="zotero://user/0/item/ABCD1234", tags=["review", "to-read"])
```

---

## zotero_add_to_collection

Add one item to a collection, by ref or exact name. The collection resolves first (names go through the cached collections listing; an unknown name fails with `ZOTERO_NOT_FOUND` before any read-modify-write), then the same read-merge-write as tags: the item's existing collections are preserved, the union is submitted under a version precondition, and an already-member item reports `added: false` without writing.

### Parameters

| Parameter    | Type   | Default | Description                                                         |
| ------------ | ------ | ------- | ------------------------------------------------------------------- |
| `ref`        | string | —       | The item ref to add                                                 |
| `collection` | string | —       | A collection ref (`zotero://user/0/collection/<KEY>`) or exact name |

### Output

`{kind: "applied", ref, version, collections, added, libraryVersion?, serverId?}`. `collections` is the full list after the add.

### Example

```
zotero_add_to_collection(ref="zotero://user/0/item/ABCD1234", collection="Methods")
```

---

## Write boundaries

The three write tools register only while `writeEnabled` is on in the settings, and they write `zotero://user/0/` (the personal library) only. Every write passes a plan-review card on the dsh side (`writeConfirm`); Zotero 10's own authorization dialog and locally issued API keys are the hard boundary beneath it: writes must carry the instance id (428 without, 412 on mismatch) and a locally issued key (`/api/local/authorize`; an "Always Allow" grant can be stored in the host credentials store bound to the issuing instance, while a one-time key is consumed at authentication time — a failed batch burns it, so a 401 re-authorizes once and replays the same batch). There is no automatic retry; every write failure other than `ZOTERO_WRITE_CONFLICT` deserves a read before another action. Writes advance the library version, and `zotero_changes` sees them.

---

## Error codes

| Error code                      | Description                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ZOTERO_WRITE_DISABLED`         | Writing is disabled in the plugin settings                                                                                            |
| `ZOTERO_WRITE_UNAUTHORIZED`     | Zotero refused write authorization: key missing or consumed (401), the dialog was declined, or no plan-approval channel is available  |
| `ZOTERO_WRITE_CONFLICT`         | The write's version precondition failed (412): the object changed after the read — re-run the tool                                    |
| `ZOTERO_WRITE_RATE_LIMITED`     | Zotero is rate-limiting write authorization requests (429, with Retry-After)                                                          |
| `ZOTERO_NOT_RUNNING`            | Zotero not running or local API unreachable                                                                                           |
| `ZOTERO_API_DISABLED`           | Zotero running but local API disabled (403)                                                                                           |
| `ZOTERO_API_VERSION`            | Zotero API version not supported                                                                                                      |
| `ZOTERO_NOT_IMPLEMENTED`        | Zotero refused the request as unimplemented (501) with no version problem: the endpoint or output format is unavailable in this build |
| `ZOTERO_SERVER_MISMATCH`        | Ref from a different Zotero instance                                                                                                  |
| `ZOTERO_NOT_FOUND`              | Referenced item, collection, or saved search does not exist                                                                           |
| `ZOTERO_NO_ATTACHMENT`          | Item has no attachment of the specified type                                                                                          |
| `ZOTERO_NO_FULLTEXT`            | Attachment has no full-text index                                                                                                     |
| `ZOTERO_FILE_MISSING`           | Local file reported by Zotero does not exist on disk                                                                                  |
| `ZOTERO_INVALID_REF`            | Ref string does not match `zotero://` syntax or references unsupported library                                                        |
| `ZOTERO_INVALID_ARGUMENT`       | Parameter violates domain constraints not expressible in schema                                                                       |
| `ZOTERO_SCOPE_AMBIGUOUS`        | Collection or saved search name matched multiple objects                                                                              |
| `ZOTERO_TIMEOUT`                | Provider internal timeout                                                                                                             |
| `ZOTERO_RESPONSE_TOO_LARGE`     | Response stream exceeded resource limit                                                                                               |
| `ZOTERO_OUTPUT_TOO_LARGE`       | Export output exceeded provider hard limit                                                                                            |
| `ZOTERO_CAPABILITY_UNAVAILABLE` | Provider did not declare the required capability                                                                                      |
| `ZOTERO_PROVIDER_UNAVAILABLE`   | Configured provider not registered, or declares a capability without implementing its method                                          |
| `ZOTERO_UNEXPECTED`             | Response could not be parsed or behaved unexpectedly                                                                                  |
