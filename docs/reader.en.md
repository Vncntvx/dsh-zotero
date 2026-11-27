<p align="right"><a href="reader.md"><b>中文</b></a></p>

# Research Reader runtime

## Component and loading

The Research Reader is the optional `dsh-zotero/reader` component, disabled by default. When enabled, the host registers the `zotero.reader*` endpoints and the browser registers a separate Document reading tab in the right sidebar. Opening the tab loads the Reader UI; opening a PDF then loads the PDF runtime and Worker. The two package-local chunks are `client.reader-ui.js` and `client.reader-pdf.js`, and the startup bundle carries no PDF.js. Reading position, history, and translation caches stay in the browser; Zotero stores annotations and notes.

The PDF runtime uses PDF.js 6.3.289 (Apache-2.0) and its public `PDFViewer`, `EventBus`, `LinkService`, `FindController`, and Worker. Pages render inside a closed shadow root, where host stylesheets and the host `:focus-visible` rule cannot reach. The build appends a shadow theme after the PDF.js sheet that references only `--dsw-*` aliases for selection, find matches, annotation popups, the focus ring, and annotation overlays. `tests/unit/tooling/reader-shadow-theme.spec.ts` rejects a literal colour or a private palette in that block. `scripts/build-client.mjs` checks the startup, Reader UI and PDF runtime factories, and `npm run smoke:reader-pdf` exercises the built runtime and Worker with a synthetic PDF.

## Document types and read paths

| Type          | Source and read path                                                                            | Boundary                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Local PDF     | The host Workspace Files Remote reads the resolved attachment path under the session permission | The host enforces read access and cancellation; closing the tab releases the file                                     |
| URL PDF       | Reuses the Library `allowUrlPdfRead` grant, download gate and lease                             | Closing releases the lease; the native preview takes over when Reader is unavailable                                  |
| HTML snapshot | Rebuilt from inert elements; scripts, forms and remote resources do not run                     | Reads up to 512 KiB of UTF-8 and shows a partial-content notice at the limit                                          |
| Markdown      | Rendered through the Harness renderer; raw HTML is omitted and images become alt text           | As above                                                                                                              |
| Plain text    | Decoded as UTF-8 with line breaks preserved                                                     | As above                                                                                                              |
| Zotero note   | `readerNote` returns bounded HTML, the current version, and editable text runs                  | Up to 256,000 UTF-16 code units of HTML and 16,000 code units of plain text; local images load on request, 2 MiB each |

Reader scopes reading state and derived indexes by attachment ref, instance, library, item, document type, and verifiable content revision. A change in file content or source generation invalidates derived caches. Text-document find is case-insensitive and spans inline formatting, highlighting up to 1,000 matches per attachment. Text quotes carry a half-open UTF-16 range in the rendered text and the SHA-256 fingerprint of a complete read. Switching to a sibling PDF re-resolves the attachment, and each attachment keeps its own reading state.

## Reading state and history

The browser stores the page, page offset, zoom, fit mode, rotation, outline and details panel layout, accumulated reading time, and last visit. When persistence is off, Reader neither saves the position nor shows recent reading. History keeps 50 entries by default and accepts 1–500 in settings; a serialized snapshot above 1,000,000 UTF-16 code units is rejected whole. Only attachment refs with a server qualifier enter the snapshot, and a parent item ref must share the same instance and library. The Library list shows the last read time by a verified parent item ref. Reading time accumulates only while both the Harness reading tab and the browser page are visible. `tests/client/reader/reading-history.spec.ts`, `ReaderTab.history.spec.tsx`, and `tests/client/library/reading-visits.spec.tsx` verify storage, timing and list updates.

## Annotations, coordinates and evidence

The PDF.js viewport converts PDF coordinates and handles CropBox, rotation and zoom at display time. A cross-page selection keeps per-page geometry and becomes one native Zotero highlight or underline per physical page; each page carries up to 1,024 rectangles and a position JSON of at most 65,000 characters. Edits and deletion carry the version shown in the interface. After approval, the domain layer reads the current object from the locked Zotero instance, checks its type and version, and lists the annotation again on a conflict. Tag changes share the versioned PATCH with scalar edits, and deletion is a single-item versioned DELETE. `tests/local/write/annotations.spec.ts` and `tests/host/write/reader-annotations.spec.ts` verify requests, stale versions and partial receipts.

An EvidenceAnchor records document identity, source type, physical page index, printed page label, section path, quote, context, rectangles, text range, content fingerprint, and precision. Navigation tries geometry, disambiguated context text, page, section and document in that order; multiple candidates require the reader's judgment. The Literature Trail passes a physical page index and rectangles to Reader, which opens that page and paints a temporary, non-interactive evidence layer. Clearing the target or re-rendering the page removes the layer. A passage without geometry uses its preview text to locate the current PDF. MinerU output participates only when the attachment fingerprint and version match. See [Architecture](architecture.en.md) for the surrounding contracts and concurrency boundaries.

## Budgets and limits

| Item                        | Limit                                       | Notes                                                                           |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| PDF full-text excerpt       | 32 physical pages, 16,000 UTF-16 code units | The preview reports truncation and pages without extractable text               |
| Text document read          | 512 KiB of UTF-8                            | A partial-content notice appears beyond the limit                               |
| Document find               | 1,000 matches                               | Counted per attachment                                                          |
| Session-model translation   | 8,000 input code units, 30 seconds          | Output is capped at 32,000 code units; local translations cache in the tab      |
| Model annotation suggestion | 1,000 output code units                     | The suggestion appears first and enters the editable comment only when accepted |
| Batch citation              | 8 entries, 1,500 code units each            | The formatted citation, including provenance, is capped at 16,000 code units    |
| Region capture              | 4,000,000 pixels, 4,096 per edge            | Region text is capped at 16,000 code units                                      |
| Browser note drafts         | 16 per tab                                  | Kept in memory when storage is unavailable                                      |

## Host boundaries and compatibility

Reader read endpoints require source access for the current session. Annotation, note, and response-note writes still pass through the core capability gate, session approval and plan review. The pinned Harness rejects write approval in an idle session; Reader keeps the pending edit or delete confirmation and the local draft. Reader composes through `sidebarRightTabs`, `sidebar.right.pane.tab`, `conversation.chat.turnTail` and the settings slots, and opens attachments from the Literature panel, the Literature Trail, and completed turns. The host verifies the item type before returning note content; external links and images stay inert.

The compatibility baseline is the Harness pinned in `package.json` and the Zotero Local API: reads support Zotero 7 and later, writes support Zotero 10 and later, and native annotation and note CRUD was verified on an isolated Zotero 11.0-beta.5. The release workflow verifies the installed PDF runtime with Chromium, Firefox and WebKit on Linux, and with Chromium on macOS and Windows. Browser-local translation depends on the Translator and Language Detector APIs and the installed language pack; session-model translation uses the model selected for the current session. Adding generated images directly to the Composer depends on a public Harness file-registration entry point; the current public input actions accept draft attachment IDs that are already registered. [Configuration reference](configuration.en.md) owns settings fields, [Features](features.en.md) owns user operations and limitations, and [Development guide](development.en.md) owns build and browser acceptance commands.
