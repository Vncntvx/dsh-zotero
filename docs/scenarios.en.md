<p align="right"><a href="scenarios.md"><b>中文</b></a></p>

# Scenarios

This document is the acceptance checklist for dsh-zotero in real conversations: whether the model calls the right tools and whether the results are usable as-is. Each prompt is also an everyday question you can reuse after acceptance.

Unit tests cannot cover model-behavior defects, such as reading full text when search was asked for, citing a missing item, or treating annotator comments as paper text. The cases below expose those problems in short conversations.

## How to use

Numbering:

- **G**: golden path. Paste G1 through G8 in one session, in order. They cover the 8 read tools and the Sources panel.
- **S / R / E / C**: capability packs. Run the pack that matches a failed step (search, retrieval, export, library structure).
- **N**: negative-boundary cases. Short, and they can run in the same session as the golden path.
- **W**: write cases. Enable “Allow writes” first. Prefer a separate session.

Token budget for the conversation:

1. State the answer format at the end of each prompt (line count, whether to explain) so the reply stays short.
2. Do not ask the model to restate tool calls; the UI tool strip is the record.
3. Each prompt tests one capability. On a wrong answer or an error, stop, record what happened, and skip later cases that depend on it.
4. Run the numbered cases in order in one session; later cases refer to “the first item” or “the item above”.
5. Copy each prompt from the code block as-is. Do not rewrite it while running.

## Preparation

Prerequisites: Zotero Desktop is running and the local API is enabled. The library should include several items, at least one item with PDF annotations or child notes, at least one collection, and some tags. In the session, `/zotero` (or the equivalent `/zotero status`) should report `connected`.

Before the W cases, enable “Allow writes” in the settings page (off by default). The whole W group can be skipped. After the golden path, check the three pages of the Zotero tab (Literature / Passages / Exports).

Record results as:

| Case | Result             | Notes |
| ---- | ------------------ | ----- |
| G1   | pass / fail / skip | …     |

## Golden path G1–G8

Paste in one session, in order. All eight passing means the read-only path is usable.

### G1 Connection and library shape

Run `/zotero` first, then ask:

```
Browse my library structure: which top-level collections are there? Roughly how many tags? One line each, at most 8 lines.
```

Expected tool: `zotero_browse` (collections, possibly tags). Acceptance: status is connected; collection names match the Zotero sidebar; a library-wide search does not replace browse. When to use: confirm library shape before choosing a search scope.

### G2 Bibliographic search

```
Find 3 items related to "literature management / Zotero / references". List only: title | year | item type. No abstracts.
```

Expected tool: `zotero_search` (metadata). Acceptance: at most 3 table rows; titles exist in the library; empty results are reported as empty, never invented. When to use: everyday literature search.

### G3 Read metadata

```
Read the first item: authors, year, journal/conference, DOI, and whether it has a PDF attachment. Within 5 lines.
```

Expected tool: `zotero_get` (often after search). PDF facts come from the attachment list. Acceptance: fields match the Zotero item pane; never invent a DOI. When to use: confirm one item before going deeper.

### G4 Child objects

```
What child notes, attachments, and annotations does the first item have? Types and titles/counts only, no bodies. At most 6 lines.
```

Expected tool: `zotero_children` (notes, attachments, annotations). Acceptance: notes and attachments come from the child listing; annotations come from the annotation listing under the PDF. Do not treat `numChildren` as proof that annotations exist. When to use: decide the read scope after seeing the child shape.

### G5 Evidence extraction

```
For the first item, find passages about "method / experiment", at most 3 pieces of evidence. Each: source type | page (if the annotation has one) | 1-2 sentences of original text. No interpretation.
```

Expected tool: `zotero_retrieve`. Acceptance: source is annotation, note, abstract, or full text; full-text passages never invent page numbers (only annotations carry pageLabel); a hit on an annotation comment is labeled as the annotator's words. When to use: you need original text for notes, not a paraphrase.

### G6 Open the source

```
Where is the first item's PDF? Give the path or link; if there is none, say so.
```

Expected tool: `zotero_attachment`. Acceptance: a local file path or URL; an explicit statement when there is no attachment. When to use: open the PDF yourself.

### G7 Export citations

```
Export the first item as BibTeX; also give one author-date in-text citation. Both as copyable text, no code explanation.
```

Expected tool: `zotero_export` (bibtex and citation). Acceptance: complete copyable BibTeX; author and year in the in-text citation match the item; the Exports page has the record. When to use: collecting citations for a paper.

### G8 Summarize and check the panel

```
Using the 3 items you just found, make a 3-row related-work table: title | year | relation to "literature management" (max 8 words). Then stop.
```

Any tools. Acceptance: stop after the answer. Then check the Zotero tab: Literature lists the session items, Passages has the G5 evidence, Exports has the G7 citations. When to use: keep a traceable snapshot at the end of a session.

## Capability packs

Re-test a failed capability with its pack. Each case can run in its own session or as a follow-up.

### S Search

**S1 Full-text mode**

```
Search the full text for "transformer" (not just titles), at most 5 hits, title + year.
```

Expected: `zotero_search(mode="everything")`. When the index is incomplete, say that hits may be missing; never claim the result is complete.

**S2 Collection scope**

```
Search only in collection "<your collection name>" for items related to "<topic word>", at most 5.
```

Expected: scope is collection. On an ambiguous collection name, report the ambiguity or ask; do not pick one silently.

**S3 Tag filter**

```
Find items tagged "<tag name>", at most 5, titles only.
```

Expected: search conditions include tags. To exclude a tag, phrase it as “items without tag X”.

**S4 Note-body hit**

```
Search for "<a unique word you wrote in a note that is not in the title>" and see if it is found.
```

Expected: the hit may come from note bodies (`supplemental`). State that the source is a note, not the title.

**S5 Saved search**

```
List my saved searches; then run the saved search named "<name>" for up to 5 results.
```

Expected: `zotero_browse(savedSearches)`, then `zotero_search` scoped to that saved search.

### R Retrieval and evidence

**R1 Detail with notes**

```
Read the item about "<title keyword>". List each child note's point in one sentence, at most 3 notes.
```

Expected: `zotero_get` with notes, or children then get. When a note is truncated, report `truncated`; do not invent unread content.

**R2 Annotations only**

```
What PDF annotations/highlights does "<title keyword>" have? Each: page | highlight or comment. At most 5.
```

Expected: annotations come back through the annotation path. Only annotations carry page numbers.

**R3 Named source**

```
Only the relevant sentences from the abstract, for "<method word>", at most 2; no full text.
```

Expected: `zotero_retrieve(sources=["abstract"])`. Mixing in full-text passages is a minor failure.

**R4 Multi-attachment coverage** (run when the item has supplements)

```
Search every indexable attachment of "<multi-attachment item>" for "<keyword>", and say which attachment has a hit and which is unindexed.
```

Expected: full-text policy is `allIndexed` or `specified`. `unindexed` means not indexed and is a coverage gap; never phrase it as “nothing in that file”.

### E Export

**E1 Bibliography**

```
Export these 3 items as one bibliography, ready to paste at the end of a paper.
```

Expected: `zotero_export(format="bibliography")`.

**E2 Multiple formats**

```
For the same 3 items, give a truncated first-chunk preview of RIS and of CSL-JSON (5 lines each). Use the export panel for the full files.
```

Expected: multiple formats are supported. Full export text is downloaded from the panel, not dumped into the chat.

**E3 Style**

```
Give me an in-text citation for this 1 item in APA (or a Chinese style), locale en-US (or zh-CN).
```

Expected: the citation call carries `style` and `locale`. A style failure returns an error; it must not silently fall back to the default style and report success.

### C Library structure and changes

**C1 Collection tree**

```
List the child collection paths under "<top-level collection>", breadcrumb format, at most 10 lines.
```

Expected: `zotero_browse` collections with `parentRef`.

**C2 Tag distribution**

```
What are the 8 most common tags? Format: tag — N items.
```

Expected: `zotero_browse` tags. Never invent counts when they are absent.

**C3 Changes baseline**

```
Record the current library version as a changes baseline.
```

Expected: `zotero_changes()` returns a cursor. A later “anything new since the baseline?” query must pass the full cursor back, not a bare version number.

## Negative boundaries N

Short cases; they can run back-to-back in one session. On failure, record the behavior. Do not ask the model to retry repeatedly.

| Case                    | Prompt                                                                                   | Expected                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| N1 Missing ref          | Read zotero://user/0/item/ZZZZZZZZ; if missing, say so.                                  | No such item or `ZOTERO_NOT_FOUND`; no invented metadata |
| N2 Bad ref syntax       | Open zotero://user/0/item/不合法.                                                        | `ZOTERO_INVALID_REF`                                     |
| N3 No attachment        | Pick an item without attachments: its PDF path?                                          | Explicit no-attachment, or `ZOTERO_NO_ATTACHMENT`        |
| N4 Empty search         | Search for a word that is certainly not in the library: qqqzzzxyz.                       | 0 results reported as such; no synonym padding           |
| N5 Cross-library export | (With a group library) export this personal item and that group item together as BibTeX. | `ZOTERO_INVALID_ARGUMENT`; suggest two calls             |
| N6 Ambiguous collection | (With a name collision) search collection "<short ambiguous name>".                      | Ambiguity error or ask; do not pick one                  |

## Writes W

Enable “Allow writes” in the Zotero settings page. Every write first shows a plan card; that confirmation cannot be turned off. Approve to write. Declining the plan card is a normal outcome. Zotero 10 may also show its own authorization dialog. Use dedicated test items and a test collection.

### W1 Plan card and create note

```
Create a child note on item "<test item>": markdown with a "## Methods" heading and two bullet points.
```

Expected: the model calls `zotero_create_note`, then a plan card appears; the write happens only after approval. The note in Zotero should be formatted HTML, not raw `##` markers. Run again and decline: the result is `declined`, nothing is written, and the model does not retry. When to use: capture reading notes.

### W2 Add tags

```
Add tags "acceptance" and "to-read" to "<test item>".
```

Expected: read-merge-write; existing tags are kept. Re-adding the same set returns `unchanged: true` without error. When to use: organize todos and topic tags.

### W3 Add to collection

```
Put "<test item>" into collection "<test collection>".
```

Expected: name resolution then write. Already a member returns `added: false`. An unknown name fails before any write. When to use: archive into a project collection.

### W4 Changes after a write

```
After those note/tag writes, can zotero_changes see them? Use the previous cursor.
```

Expected: `zotero_changes` carries the full cursor; `changed` or `totals` reflects the write. When to use: sync recent changes.

## Run order

1. `/zotero`. On failure, read [troubleshooting](troubleshooting.en.md) first and stop.
2. Golden path G1–G8 in one session, then check the three Sources pages.
3. Re-test the failed step with its capability pack.
4. Negative boundaries N1–N6.
5. If write is in scope, run W1–W4 in a new session.

## Coverage map

| Area          | Tool                                       | Cases          | Covers                                               |
| ------------- | ------------------------------------------ | -------------- | ---------------------------------------------------- |
| Connection    | `/zotero`                                  | G1             | connected, versions                                  |
| Library shape | `zotero_browse`                            | G1, C1, C2, S5 | collection tree, tags, saved searches                |
| Search        | `zotero_search`                            | G2, S1–S4      | metadata/everything, collection, tags, note hits     |
| Metadata      | `zotero_get`                               | G3, R1         | standard fields, notes, truncation                   |
| Child objects | `zotero_children`                          | G4, R2         | three child kinds, annotation path                   |
| Evidence      | `zotero_retrieve`                          | G5, R3, R4     | four sources, page labels, multi-attachment coverage |
| Attachments   | `zotero_attachment`                        | G6, N3         | path/URL, no attachment                              |
| Export        | `zotero_export`                            | G7, E1–E3      | multiple formats, style, batching                    |
| Changes       | `zotero_changes`                           | C3, W4         | cursor identity, visibility after write              |
| Writes        | create_note / add_tags / add_to_collection | W1–W3          | plan card, merge write, declined                     |
| Panel         | Sources three pages                        | G8             | Literature / Passages / Exports                      |
| Edges         | error codes                                | N1–N6          | no invention, no silent fallback                     |

Pass bar: G1–G8 all pass, and N1, N2, N4 show no invented content. Writes are optional; if enabled, W1's plan card and W2's idempotent `unchanged` must pass.

## Failure map

| Symptom                                  | Check                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Answer without any tool call             | Plugin installed? Session created after the plugin loaded? `/zotero`                                |
| Odd search results                       | Query, scope, Zotero quick-search syntax, full-text index completeness                              |
| Page number on a `fulltext` source       | Correct the model if it misread fields; if the tool returned a page number, that is a plugin defect |
| Annotation comment treated as paper text | Check `matchedFields=comment`; see [tool reference](tools.en.md)                                    |
| Export unusable in LaTeX                 | Confirm `format` is bibtex/biblatex; use the panel download                                         |
| Write fails with no plan card            | Is “Allow writes” on? Was the call rejected before the plan (the confirmation has no off switch)    |
| Model retries after a declined plan      | Behavior issue: `declined` is not a retryable error                                                 |
| Sources pages empty                      | `webEnabled`; did this session actually call tools? Refresh the page                                |

## Division of labor with machine tests

| Layer                         | Method                              | Covers                                    |
| ----------------------------- | ----------------------------------- | ----------------------------------------- |
| Contract, types, client graph | `npm run release:check`             | interface breaks, missing pack files      |
| Real dependency stack         | `smoke.mjs` / `discovery-smoke.mjs` | tool registration, production install     |
| Real Zotero integration       | `npm run test:integration`          | HTTP contract, edge conditions            |
| This document                 | real conversations                  | model behavior, UI copy, panel, usability |

After the machine tests pass, use this document for the final human-plus-model acceptance.
