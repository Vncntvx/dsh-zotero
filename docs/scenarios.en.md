<p align="right"><a href="scenarios.md"><b>中文</b></a></p>

# Scenarios

This document serves as the acceptance checklist for dsh-zotero in real conversations, validating model tool invocation behaviors and the usability of returned results. The prompts contained herein reflect everyday search and research queries and can be directly reused in daily workflows once verified.

Because unit tests cannot fully cover reasoning discrepancies at the model level (such as substituting full-text search for bibliographic search, hallucinating missing item references, or treating annotator comments as paper body text), this document verifies those boundaries through standardized conversation cases.

## How to Use

Case numbering conventions:

- **G**: Golden Path. Executed sequentially from G1 to G8 in a single session, covering all 8 read tools and the Sources panel;
- **S / R / E / C**: Independent capability packs. Used to test specific domains when a golden path step fails (search, retrieval, export, library structure);
- **N**: Negative boundary cases. Validates error handling and anti-hallucination behavior under abnormal inputs and boundary conditions;
- **W**: Write cases. Requires enabling "Allow writes" in settings first; recommended for execution in an isolated session.

Execution guidelines:

1. State the expected output format at the end of each prompt (e.g. line limits, whether explanation is needed) to prevent verbose responses;
2. Do not ask the model to restate its tool calls; verify dedicated Toolview cards and execution state rendered in the UI instead;
3. Each prompt focuses on a single capability point. On errors or incorrect responses, record the symptom and skip dependent follow-up cases;
4. Golden path cases must be executed sequentially in the same session, as later cases rely on conversational context (e.g. "the first item", "the item above");
5. Copy each prompt block as-is without modifying the text during execution.

## Preparation

Prerequisites:

- Zotero Desktop is running with the Local API enabled (default port `23119`);
- The library should contain: several standard items, at least one item with PDF annotations or child notes, at least one collection, and several tags;
- Enable the plugin in Harness plugin management. The onboarding guidance window should show a green ready state with the local version displayed;
- Run `/zotero` (or `/zotero status`) in a session; the status card should display `connected`.

Before running the W group write cases, enable "Allow writes" in "Settings → Zotero" (disabled by default). After completing the golden path, observe the dedicated tool cards generated at each step (item title/year badges, highlighted evidence passages, BibTeX export cards, etc.) and inspect the three pages of the Sources panel (Literature / Passages / Exports).

Result recording format:

| Case | Result             | Notes |
| ---- | ------------------ | ----- |
| G1   | Pass / Fail / Skip | …     |

## Golden Path (G1–G8)

Execute sequentially in the same session. Passing all eight indicates that the read-only main path is fully functional.

### G1 Connection and Library Shape

Run `/zotero` first, then ask:

```
Browse my library structure: which top-level collections are there? Roughly how many tags? One line each, at most 8 lines.
```

- Expected tool: `zotero_browse` (collections, possibly tags);
- Acceptance criteria: `/zotero` renders a dedicated status card showing `connected`; collection names match the Zotero sidebar; a library-wide search does not replace browse;
- When to use: Confirm library shape and search scope before querying.

**Endpoint matches configuration (G1 edge)**: In "Settings → Zotero", change `baseUrl` to another local address (such as `http://localhost:23119/api`), then re-run `/zotero`. The status card endpoint should update to the probed address rather than remaining a fixed `127.0.0.1:23119`, and remains visible when disconnected. Purpose: confirms the card displays probe results rather than hardcoded constants.

### G2 Bibliographic Search

```
Find 3 items related to "literature management / Zotero / references". List only: title | year | item type. No abstracts.
```

- Expected tool: `zotero_search` (metadata mode);
- Acceptance criteria: Output table contains at most 3 rows; titles exist in the library; empty results are reported truthfully without hallucinating items;
- When to use: Routine bibliographic search.

### G3 Read Metadata

```
Read the first item: authors, year, journal/conference, DOI, and whether it has a PDF attachment. Within 5 lines.
```

- Expected tool: `zotero_get` (often following search results); attachment details come from the item's attachment list;
- Acceptance criteria: Fields match the Zotero item pane; DOIs are never hallucinated;
- When to use: Inspect detailed metadata for a single item.

### G4 Child Objects

```
What child notes, attachments, and annotations does the first item have? Types and titles/counts only, no bodies. At most 6 lines.
```

- Expected tool: `zotero_children` (retrieves notes, attachments, and annotations);
- Acceptance criteria: Notes and attachments come from the child object list; annotations come from the annotation list under the PDF; `numChildren` is not used as proof that annotations exist;
- When to use: Assess child object composition before deciding reading scope.

### G5 Evidence Extraction

```
For the first item, find passages about "method / experiment", at most 3 pieces of evidence. Each: source type | page (if the annotation has one) | 1-2 sentences of original text. No interpretation.
```

- Expected tool: `zotero_retrieve`;
- Acceptance criteria: Source is one of annotation, note, abstract, or full text; full-text passages never hallucinate page numbers (only annotations carry `pageLabel`); hits on annotation comments are explicitly labeled as annotator commentary;
- When to use: Extract verbatim text from papers as evidence or note material.

### G6 Get Original Attachment Path

```
Where is the first item's PDF? Give the path or link; if there is none, say so.
```

- Expected tool: `zotero_attachment`;
- Acceptance criteria: Returns a valid local file path or URL; explicitly states when no attachment exists;
- When to use: Need to open original documents directly in local or external readers.

### G7 Export Citations

```
Export the first item as BibTeX; also give one author-date in-text citation. Both as copyable text, no code explanation.
```

- Expected tool: `zotero_export` (bibtex and citation formats);
- Acceptance criteria: BibTeX syntax is complete and directly copyable; author and year in the in-text citation match the item; the Sources panel "Exports" page records the export;
- When to use: Citation collection during academic writing.

### G8 Summarize and Check Panel

```
Using the 3 items you just found, make a 3-row related-work table: title | year | relation to "literature management" (max 8 words). Then stop.
```

- Tool invocation: Model synthesizes response autonomously;
- Acceptance criteria: Stops output after answering. Then inspect the Sources panel: Literature contains session items, Passages contains G5 evidence, Exports contains G7 citations;
- When to use: Conclude a research query task and establish a traceable session snapshot.

## Independent Capability Packs

When a golden path step fails, use the corresponding capability pack for focused testing. Each case can run in an isolated session or as a follow-up query.

### S Search Capability Pack

**S1 Full-Text Mode**

```
Search the full text for "transformer" (not just titles), at most 5 hits, title + year.
```

Expected: Calls `zotero_search(mode="everything")`. If the local full-text index is incomplete, it should indicate potential omissions rather than claiming complete results.

**S2 Collection Scope**

```
Search only in collection "<your collection name>" for items related to "<topic word>", at most 5.
```

Expected: Search scope is restricted to the specified collection. If the collection name is ambiguous, it should return an error or ask for confirmation rather than choosing arbitrarily.

**S3 Tag Filter**

```
Find items tagged "<tag name>", at most 5, titles only.
```

Expected: Search criteria includes the `tags` parameter. Phrased as "without tag X" when excluding tags.

**S4 Note Body Hits**

```
Search for "<a unique word you wrote in a note that is not in the title>" and see if it is found.
```

Expected: Hits originate from note bodies (`supplemental` source), and the response clarifies that the hit came from a note rather than an item title.

**S5 Saved Searches**

```
List my saved searches; then run the saved search named "<name>" for up to 5 results.
```

Expected: Calls `zotero_browse(type="savedSearches")` to retrieve the list, then calls `zotero_search` scoped to that saved search.

### R Retrieval and Evidence Capability Pack

**R1 Details with Notes**

```
Read the item about "<title keyword>". List each child note's point in one sentence, at most 3 notes.
```

Expected: Calls `zotero_get(includeNotes=true)` or retrieves notes via `zotero_children`. If note content is truncated, it marks `truncated` and does not hallucinate unread content.

**R2 Annotations Only**

```
What PDF annotations/highlights does "<title keyword>" have? Each: page | highlight or comment. At most 5.
```

Expected: Annotations return via the dedicated annotation path; page numbers exist only on annotations.

**R3 Specific Evidence Source**

```
Only the relevant sentences from the abstract, for "<method word>", at most 2; no full text.
```

Expected: Calls `zotero_retrieve(sources=["abstract"])`. Mixing in full-text passages is considered a failure.

**R4 Multi-Attachment Coverage** (Run on items with supplementary materials or multiple attachments)

```
Search every indexable attachment of "<multi-attachment item>" for "<keyword>", and say which attachment has a hit and which is unindexed.
```

Expected: Full-text retrieval strategy is `allIndexed` or a specified list. Unindexed attachments are marked `unindexed` and explained as retrieval coverage gaps, never as "file contains no relevant content".

### E Export Capability Pack

**E1 Bibliography**

```
Export these 3 items as one bibliography, ready to paste at the end of a paper.
```

Expected: Calls `zotero_export(format="bibliography")` to produce standard bibliography text.

**E2 Multiple Formats**

```
For the same 3 items, give a truncated first-chunk preview of RIS and of CSL-JSON (5 lines each). Use the export panel for the full files.
```

Expected: Supports requested export formats. Full export content is downloaded from the Sources panel to avoid dumping large text blocks into chat.

**E3 Citation Styles**

```
Give me an in-text citation for this 1 item in APA (or a Chinese style), locale en-US (or zh-CN).
```

Expected: Calls `zotero_export` with `style` and `locale` parameters. If the style is unsupported or rendering fails, it returns an error rather than silently falling back to default styling.

### C Library Structure and Changes Capability Pack

**C1 Collection Tree**

```
List the child collection paths under "<top-level collection>", breadcrumb format, at most 10 lines.
```

Expected: Calls `zotero_browse(type="collections")` and parses `parentRef` relationships into a hierarchical tree.

**C2 Tag Distribution**

```
What are the 8 most common tags? Format: tag: N items.
```

Expected: Calls `zotero_browse(type="tags")` to fetch the tag list. If tag counts are missing, numbers must not be fabricated.

**C3 Changes Baseline**

```
Record the current library version as a changes baseline.
```

Expected: Calls `zotero_changes()` and retains the returned `cursor`. Subsequent queries for "changes since last baseline" must pass back the full cursor, not just a version number.

## Negative Boundary Cases (N)

Validates boundary conditions and error handling; can run continuously in a single session. On unexpected behavior, record the symptom without demanding repetitive retries.

| Case                    | Prompt                                                                                   | Expected Behavior                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| N1 Non-existent ref     | Read zotero://user/0/item/ZZZZZZZZ; if missing, say so.                                  | Explicitly states no such item or returns `ZOTERO_NOT_FOUND`; no hallucinated metadata |
| N2 Invalid ref syntax   | Open zotero://user/0/item/invalid.                                                       | Returns `ZOTERO_INVALID_REF` error                                                     |
| N3 No attachment        | Pick an item without attachments: its PDF path?                                          | Explicitly states no attachment or returns `ZOTERO_NO_ATTACHMENT`                      |
| N4 Empty search         | Search for a word that definitely does not exist: qqqzzzxyz.                             | Reports 0 results; no padding with irrelevant synonyms                                 |
| N5 Cross-library export | (With a group library) export this personal item and that group item together as BibTeX. | Returns `ZOTERO_INVALID_ARGUMENT` and suggests separate exports                        |
| N6 Ambiguous collection | (With duplicate collection names) search collection "<ambiguous name>".                  | Reports name ambiguity or asks for confirmation; does not choose arbitrarily           |

## Write Cases (W)

Enable "Allow writes" in "Settings → Zotero". Write operations must pass the session approval policy check (`approval/policy`; a policy of `never` auto-rejects without presenting a plan card), then display the plan review card (this confirmation cannot be bypassed). Writes execute only after user approval. Rejection at either tier is normal behavior. Interactive sessions may sequentially present permission confirmation and the plan card. Zotero Desktop may additionally show a local authorization dialog on the first write. Use dedicated test items and collections.

### W1 Plan Review Card and Create Note

```
Create a child note on item "<test item>": markdown with a "## Methods" heading and two bullet points.
```

- Expected behavior: Model calls `zotero_create_note`, prompting the plan review card, and completes write after approval. The note in Zotero should be formatted HTML rather than raw Markdown markers;
- Rejection test: Run again and click decline on the plan card; the operation returns `declined`, nothing is written, and the model does not retry;
- When to use: Capture reading notes and literature summaries.

**Policy rejection (W1 variant)**: Set the session approval policy to `never` (or run unattended) and call a write tool. Expected behavior: returns `declined`, no plan card appears, and Zotero receives no write request; session log records `approval/asked` and `approval/decided` (outcome: rejected).

**Unverified commit (W1 edge)**: If Zotero accepts a write but the response cannot verify final state, the operation returns `committed-unverified`. The card displays a warning state, presents the advisory ("do not retry; verify by key/ref"), and the model does not automatically retry. Used to verify that post-verification failures do not falsely report success.

### W2 Add Tags

```
Add tags "acceptance" and "to-read" to "<test item>".
```

- Expected behavior: Follows a read-merge-write workflow, preserving existing tags. Re-adding the same tag set returns `unchanged: true` without errors;
- When to use: Manage reading status and thematic tags.

### W3 Add to Collection

```
Put "<test item>" into collection "<test collection>".
```

- Expected behavior: Resolves collection name then performs write. If the item is already in the collection, returns `added: false`; if the collection name does not exist, fails before issuing any write request;
- When to use: Archive retrieved literature into project collections.

### W4 Post-Write Incremental Sync

```
After those note/tag writes, can zotero_changes see them? Use the previous cursor.
```

- Expected behavior: Calls `zotero_changes` passing the full cursor; `changed` or `totals` reflects the recent write;
- When to use: Track recent library modifications incrementally.

## Execution Order

1. Run `/zotero` to test connectivity. On failure, consult the [Troubleshooting Guide](troubleshooting.en.md) and stop;
2. Execute Golden Path G1 through G8 sequentially in a single session, then inspect the Sources panel (Literature / Passages / Exports);
3. Supplement with specific capability packs (S / R / E / C) for any failed golden path steps;
4. Execute negative boundary cases N1 through N6;
5. To verify write functionality, run W1 through W4 in a separate session.

## Coverage Map

| Capability Dimension | Tool                                             | Associated Cases | Key Verification Points                                                |
| -------------------- | ------------------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| Service Connectivity | `/zotero`                                        | G1               | connected state, version acquisition                                   |
| Library Shape        | `zotero_browse`                                  | G1, C1, C2, S5   | Collection tree, tag list, saved searches                              |
| Bibliographic Search | `zotero_search`                                  | G2, S1–S4        | metadata/everything modes, collection/tag scopes, note hits            |
| Metadata Reading     | `zotero_get`                                     | G3, R1           | Standard fields, child notes, truncation flags                         |
| Child Object Reading | `zotero_children`                                | G4, R2           | Notes/attachments/annotations, dedicated annotation path               |
| Evidence Extraction  | `zotero_retrieve`                                | G5, R3, R4       | Four source types, annotation page accuracy, multi-attachment coverage |
| Attachment Path      | `zotero_attachment`                              | G6, N3           | Local absolute paths and URLs, missing attachment handling             |
| Citation Export      | `zotero_export`                                  | G7, E1–E3        | Multi-format support, custom styles, batching and panel downloads      |
| Incremental Sync     | `zotero_changes`                                 | C3, W4           | Cursor persistence, immediate visibility after write                   |
| Content Writing      | `create_note` / `add_tags` / `add_to_collection` | W1–W3            | Approval and plan card, merge write, declined state                    |
| Data Panel           | Sources panel                                    | G8               | Synchronization across Literature, Passages, and Exports pages         |
| Boundary Defense     | Error handling and safeguards                    | N1–N6            | Error code accuracy, anti-hallucination, no silent degradation         |

Passing criteria: G1 through G8 all pass, and N1, N2, N4 produce no hallucinated content. Write features are optional; if enabled, W1 plan card confirmation and W2 idempotent writes must pass.

## Symptom and Failure Diagnosis

| Symptom                                  | Diagnosis Direction                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Answers without calling tools            | Check plugin installation; check if session was created after plugin loaded; run `/zotero status` |
| Unexpected search results                | Inspect query terms, search mode, collection scope, quick-search syntax, and local index status   |
| Page number on fulltext evidence         | Model misread fields (prompt to correct); if tool natively returned it, investigate parsing error |
| Annotation comment treated as paper text | Check if labeled with `matchedFields=comment`, see [Tool Reference](tools.en.md)                  |
| Export cannot be used in LaTeX           | Verify `format` is `bibtex` or `biblatex`; download via Sources panel instead                     |
| Write fails without plan card            | Check if "Allow writes" is enabled; verify if arguments were rejected prior to plan review        |
| Model retries after plan rejection       | Model behavioral fault: `declined` is a terminal state and should not trigger auto-retries        |
| Sources panel pages are empty            | Check `webEnabled` configuration; check if session called tools; refresh browser page             |

## Division of Labor with Automated Testing

| Verification Tier                       | Testing Method                      | Core Coverage                                                   |
| --------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Protocol contracts and type definitions | `npm run release:check`             | Interface compatibility, client module graph, package integrity |
| Dependency integration and lifecycle    | `smoke.mjs` / `discovery-smoke.mjs` | Tool registration, production installation                      |
| Real Local API wire protocols           | `npm run test:integration`          | Local HTTP communication, real data boundaries                  |
| Model behavior and user experience      | This scenarios document             | Invocation reasoning, interactive cards, panel sync, usability  |

After all automated machine tests pass, this document completes final human-model interaction and scenario usability acceptance.
