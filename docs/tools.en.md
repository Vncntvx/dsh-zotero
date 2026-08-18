<p align="right"><a href="tools.md"><b>中文</b></a></p>

# dsh-zotero Tool Reference

dsh-zotero registers 5 tools that operate on the user's library through the local Zotero HTTP API. All refs are stable identifiers in `zotero://user/0/item/<KEY>` format.

---

## zotero_search

Discover candidate entries in the library. Metadata mode searches title/author/year; everything mode also searches the full-text index.

### Parameters

| Parameter   | Type                           | Default             | Description                                                                               |
| ----------- | ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `query`     | string                         | —                   | Free-text query; omit to browse the full library                                          |
| `mode`      | `"metadata"` \| `"everything"` | `"metadata"`        | Search scope                                                                              |
| `scope`     | object                         | `{kind: "library"}` | `{kind:"library"}` / `{kind:"collection", refOrName}` / `{kind:"savedSearch", refOrName}` |
| `itemTypes` | string[]                       | —                   | Zotero item type names (e.g. `journalArticle`), OR combined                               |
| `tags`      | string[]                       | —                   | Tag names, AND semantics                                                                  |
| `sort`      | string                         | `"dateModified"`    | Sort field: `dateModified` / `dateAdded` / `date` / `title` / `creator`                   |
| `direction` | `"asc"` \| `"desc"`            | `"desc"`            | Sort direction                                                                            |
| `offset`    | integer                        | `0`                 | Pagination offset                                                                         |
| `limit`     | integer                        | `10`                | Max return count (capped by `maxSearchResults`, default 20)                               |

### Output

`scope`, `items` (ref, title, creatorSummary, year, itemType, bestAttachmentRef, bestAttachmentType), `total`, `offset`, `returned`, `nextOffset`, `noteMatches`

### Notes

On the first query (offset 0), the client scans note bodies and merges them into results (up to `limit` items). `noteMatches` reports how many came from note scanning; these do not count toward the pagination total.

### Example

```
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

Read a single item's full metadata. By default returns only metadata; specifying `include` triggers an additional `/children` call for child content.

### Parameters

| Parameter | Type                                        | Required | Description                    |
| --------- | ------------------------------------------- | -------- | ------------------------------ |
| `ref`     | string                                      | ✓        | Item ref                       |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —        | Child content types to include |

### Output

`ref`, `itemType`, `title`, `creators`, `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`, `noteBody` (note items), `tags`, `collections`, `children`, `bestAttachment`, plus requested `notes`/`annotations`/`attachments` (with total, returned, items)

### Example

```
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

Collect and query-rank evidence passages for a single item. Sources include: Zotero annotations (with page labels), notes, abstract, and full-text chunks (BM25 ranked).

### Parameters

| Parameter  | Type     | Default | Description                                                           |
| ---------- | -------- | ------- | --------------------------------------------------------------------- |
| `ref`      | string   | —       | Item ref (required)                                                   |
| `query`    | string   | —       | Query terms for ranking evidence (required)                           |
| `sources`  | string[] | All 4   | `annotation` / `note` / `abstract` / `fulltext`                       |
| `passages` | integer  | `4`     | Max return passage count (capped by `maxEvidencePassages`, default 4) |

### Output

`ref`, `attachmentRef`, `attachmentContentType`, `coverage` (indexedChars/totalChars/complete etc.), `evidence` (source, sourceRef, text, chunkIndex, chunkCount, comment, pageLabel), `truncated`, `sourcesSkipped`

### Notes

- Only Zotero annotations carry page labels; full-text passages never have fabricated page numbers
- Unavailable sources are skipped and reported in `sourcesSkipped`
- Only `annotation` sources have `pageLabel`; full-text passages never carry page numbers
- `truncated` true indicates more evidence was cut off

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

- `{kind: "file", path, ref, title, contentType}` — local file (verified via `existsSync`)
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

### Example

```
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
```

---

## Error codes

| Error code                      | Description                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `ZOTERO_NOT_RUNNING`            | Zotero not running or local API unreachable                                    |
| `ZOTERO_API_DISABLED`           | Zotero running but local API disabled (403)                                    |
| `ZOTERO_API_VERSION`            | Zotero API version not supported                                               |
| `ZOTERO_SERVER_MISMATCH`        | Ref from a different Zotero instance                                           |
| `ZOTERO_NOT_FOUND`              | Referenced item, collection, or saved search does not exist                    |
| `ZOTERO_NO_ATTACHMENT`          | Item has no attachment of the specified type                                   |
| `ZOTERO_NO_FULLTEXT`            | Attachment has no full-text index                                              |
| `ZOTERO_FILE_MISSING`           | Local file reported by Zotero does not exist on disk                           |
| `ZOTERO_INVALID_REF`            | Ref string does not match `zotero://` syntax or references unsupported library |
| `ZOTERO_INVALID_ARGUMENT`       | Parameter violates domain constraints not expressible in schema                |
| `ZOTERO_SCOPE_AMBIGUOUS`        | Collection or saved search name matched multiple objects                       |
| `ZOTERO_TIMEOUT`                | Provider internal timeout                                                      |
| `ZOTERO_RESPONSE_TOO_LARGE`     | Response stream exceeded resource limit                                        |
| `ZOTERO_OUTPUT_TOO_LARGE`       | Export output exceeded provider hard limit                                     |
| `ZOTERO_CAPABILITY_UNAVAILABLE` | Provider did not declare the required capability                               |
| `ZOTERO_PROVIDER_UNAVAILABLE`   | Configured provider not registered                                             |
| `ZOTERO_UNEXPECTED`             | Response could not be parsed or behaved unexpectedly                           |
