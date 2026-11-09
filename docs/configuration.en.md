<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# Configuration Reference

dsh-zotero configuration is split across four settings namespaces. Each namespace gets its field defaults from its own Schemastery schema and is validated on load or save; an invalid value blocks plugin loading or that namespace's configuration write.

- Core `zotero` namespace: `src/config.ts`, 37 fields, runtime validation by `resolveConfig`;
- Literature panel `library` namespace: `src/library/config.ts`, 11 fields;
- Scholarly search `scholarly` namespace: `src/scholarly/config.ts`, 9 fields;
- Document parsing `parsing` namespace: `src/parsing/config.ts`, 4 fields.

The four groups total 61 fields. Every field is declared `volatile`, and a configuration write lands under `config` on the matching entry (`zotero` / `library` / `scholarly` / `parsing`) in the current profile's `cordis.patch.yml`.

## Settings tabs and field ownership

The configuration area of the plugin detail page is a 7-tab form that edits all four namespaces at once. Tabs, namespaces, and fields line up as follows:

| Tab                 | Settings namespace  | Fields | Groups and fields                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General             | `zotero`            | 6      | Literature trail: `webEnabled`; Writing: `writeEnabled`, `writePersistKey`, `writeNoteMaxChars`, `writeListMaxItems`, `writeAuthorizeDeadlineMs`                                                                                                                                                                                        |
| Connection          | `zotero`            | 5      | Connection: `baseUrl`, `provider`, `timeoutMs`, `maxInFlightRequests`, `scopeListingTtlMs`                                                                                                                                                                                                                                              |
| Search & Extraction | `zotero`            | 13     | Search & Concurrency: `maxSearchResults`, `maxNoteScanRecords`, `searchConcurrency`, `graphConcurrency`, `retrieveAttachmentCap`; Passages & Fulltext Extraction: `maxEvidenceChars`, `maxEvidencePassages`, `maxNoteChars`, `maxNoteRecords`, `maxAnnotationRecords`, `maxAttachmentRecords`, `fulltextChunkWords`, `maxFulltextChars` |
| Literature panel    | `library`, `zotero` | 13     | 11 panel preferences for display, details, browsing, PDF reading, citations and conversation; citation defaults: `defaultStyle`, `defaultLocale`                                                                                                                                                                                        |
| Scholarly Search    | `scholarly`         | 9      | Identity and credential references: `email`, `s2ApiKeyEnv`, `ncbiApiKeyEnv`, `openalexApiKeyEnv`; Search & Full-text Quotas: `maxResults`, `maxContentChars`; Background tasks: `enableRunInBackground`, `promoteOnTimeout`, `foregroundWaitMs`                                                                                         |
| Document Parsing    | `parsing`           | 4      | Mode and output: `mode`, `mineruTokenRef`, `allowParsingUpload`, `outputDir`                                                                                                                                                                                                                                                            |
| Advanced            | `zotero`            | 11     | Output limits: `maxInlineResultTokens`, `maxInlineResultBytes`, `maxResponseBytes`, `maxExportChars`, `maxExportRefs`, `maxBrowseResults`, `maxChangesResults`; Background tasks: `enableRunInBackground`, `promoteOnTimeout`, `foregroundWaitMs`; Diagnostics: `debug`                                                                 |

`webEnabled` sits under "General → Literature trail", and the toggle is named "Show literature trail"; it decides whether the literature trail tab appears at the top of the conversation. The literature panel also needs the `dsh-zotero/library` component row to be composed and this component's `rightSidebarEnabled` to be on, as described below in "Literature panel component configuration".

## Core fields (`zotero`, 37)

| Field                      | Default                      | Description                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API address; must be loopback HTTP with a `/api` path prefix (`localhost` resolves to `127.0.0.1` at runtime)                                                                                                                 |
| `provider`                 | `local`                      | Selected provider identifier                                                                                                                                                                                                               |
| `timeoutMs`                | `5000`                       | Timeout for a single HTTP request (ms)                                                                                                                                                                                                     |
| `maxInFlightRequests`      | `8`                          | Cap on concurrent in-flight requests to the Local API                                                                                                                                                                                      |
| `maxSearchResults`         | `20`                         | Cap on items returned by `zotero_search`; also clamps the literature panel's search page size (the response carries the effective `limit`)                                                                                                 |
| `maxNoteScanRecords`       | `200`                        | Cap on note records scanned when searching note content                                                                                                                                                                                    |
| `searchConcurrency`        | `4`                          | Concurrency for parent attribution queries in `zotero_search`                                                                                                                                                                              |
| `maxEvidenceChars`         | `6000`                       | Total character budget for retrieved passages                                                                                                                                                                                              |
| `maxEvidencePassages`      | `4`                          | Cap on the number of retrieved passages                                                                                                                                                                                                    |
| `maxNoteChars`             | `2000`                       | Panel childPage preview budget; full tool bodies are unchanged                                                                                                                                                                             |
| `maxNoteRecords`           | `50`                         | Maximum notes per explicit page; full reads are uncapped                                                                                                                                                                                   |
| `maxAnnotationRecords`     | `100`                        | Maximum annotations per explicit page; full reads are uncapped                                                                                                                                                                             |
| `maxAttachmentRecords`     | `50`                         | Maximum attachments per explicit page; full reads are uncapped                                                                                                                                                                             |
| `fulltextChunkWords`       | `200`                        | Words per full-text chunk that enters the ranking                                                                                                                                                                                          |
| `maxFulltextChars`         | `250000`                     | Maximum full-text characters one `zotero_retrieve` call accepts (split evenly across multiple attachments)                                                                                                                                 |
| `retrieveAttachmentCap`    | `16`                         | Cap on attachments that join full-text ranking in one `zotero_retrieve` call                                                                                                                                                               |
| `graphConcurrency`         | `4`                          | Concurrency for attachment reads in `zotero_retrieve`                                                                                                                                                                                      |
| `maxInlineResultTokens`    | `4000`                       | Official Harness token estimate limit for both canonical and rendered inline results; positive safe integer.                                                                                                                               |
| `maxInlineResultBytes`     | `65536`                      | Independent serialized inline byte limit; exceeding either budget requires durable file delivery.                                                                                                                                          |
| `maxResponseBytes`         | `16777216`                   | Streaming byte cap for a single API response (16 MiB)                                                                                                                                                                                      |
| `maxExportChars`           | `1000000`                    | Hard character cap on export output (1,000,000 characters)                                                                                                                                                                                 |
| `maxExportRefs`            | `50`                         | Ref cap for a single `zotero_export` call; the literature panel's `zotero/export` endpoint shares this cap                                                                                                                                 |
| `maxBrowseResults`         | `50`                         | Cap on items returned by a single `zotero_browse` call; also clamps the literature panel's browse page size (collection tree / tags / saved searches, the response carries the effective `limit`)                                          |
| `maxChangesResults`        | `50`                         | Cap on items listed per resource kind in `zotero_changes` (presentation only)                                                                                                                                                              |
| `scopeListingTtlMs`        | `30000`                      | How long a collection or search scope listing is trusted before it is read again (ms)                                                                                                                                                      |
| `defaultStyle`             | `apa`                        | CSL citation style (must be built into Zotero); used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                        |
| `defaultLocale`            | `en-US`                      | CSL citation locale; used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                                                   |
| `writeEnabled`             | `false`                      | Whether to register and enable personal library write tools                                                                                                                                                                                |
| `writePersistKey`          | `true`                       | Whether Always-Allow write keys are stored in the host credentials manager; a stored grant can be revoked from the settings page's Writing group                                                                                           |
| `writeNoteMaxChars`        | `65536`                      | Character cap for one research note body                                                                                                                                                                                                   |
| `writeListMaxItems`        | `50`                         | Item cap for list-shaped write arguments: `add`/`remove` on `update_item_tags`/`update_item_collections`, `tags` on `delete_library_tags`, and `collections`/`tags`/`sourceRefs` on `create_note`                                          |
| `writeAuthorizeDeadlineMs` | `120000`                     | Time limit for waiting on the Zotero authorization dialog during a write (ms)                                                                                                                                                              |
| `webEnabled`               | `true`                       | Whether to show the literature trail tab at the top of the conversation                                                                                                                                                                    |
| `enableRunInBackground`    | `true`                       | Whether requests with `run_in_background: true` may run in the background (the parameter is always declared; passing `true` while this is off returns a structured refusal)                                                                |
| `promoteOnTimeout`         | `true`                       | Whether a foreground export or changes sync that times out is promoted to a background job                                                                                                                                                 |
| `foregroundWaitMs`         | `4000`                       | Foreground wait limit (ms), after which the operation is promoted to a background Job                                                                                                                                                      |
| `debug`                    | `false`                      | Whether diagnostic mode is on; when on, it shows the diagnostics panel at the bottom of the plugin detail page and records request paths and tool-call details; logs stay in process memory only and are never written to disk or sent out |

Note: `foregroundWaitMs` controls how long a foreground task waits before it is promoted to a background Job; `timeoutMs` controls the timeout of one Zotero HTTP request. The two are independent.

## Validation rules

`writeNoteMaxChars` constrains both the note creation and note update tools: before approval the original Markdown is checked by JavaScript string length, including whitespace and markup, and is never truncated automatically.

`resolveConfig` runs the following validation when the core component loads:

- `baseUrl` must be a string, must use the `http:` scheme (the Zotero Local API does not support HTTPS), and must carry no credentials, query string, or URL fragment;
- the `baseUrl` host must be a loopback address (`127.0.0.1`, `localhost`, `::1`, `[::1]`); `localhost` resolves to `127.0.0.1` at runtime;
- the `baseUrl` path must be `/api` or start with `/api/`;
- `timeoutMs` must be a positive finite number;
- every other numeric field (concurrency, the various caps, `scopeListingTtlMs`, `foregroundWaitMs`, `writeNoteMaxChars`, `writeListMaxItems`, `writeAuthorizeDeadlineMs`) must be a positive integer;
- `writeEnabled`, `writePersistKey`, `webEnabled`, `enableRunInBackground`, `promoteOnTimeout`, and `debug` must be booleans;
- `provider`, `defaultStyle`, and `defaultLocale` must be non-empty strings.

The 11 literature panel preferences are validated at mount and on every commit against the booleans, enums and unique section list below. The scholarly schema is validated by its component: `maxResults` must be an integer from 1 to 100; `maxContentChars` must be an integer from 1,000 to 50,000; `enableRunInBackground` and `promoteOnTimeout` must be booleans; `foregroundWaitMs` must be an integer from 1 to 240,000; the credential-reference fields must be strings, where an empty value disables that key and a non-empty value is resolved by `src/scholarly/credentials.ts` as an environment-variable name before every tool call.

## Configuration priority

```text
Schema defaults → Composition entry config → the current profile's Cordis patch layer
```

All four namespaces follow the same order. The override layer (`config` on the matching entry in the current profile's `cordis.patch.yml`) outranks schema defaults and entry config; a home patch or command-line overlay outranks it, and a form write that they would override is refused.

## Plugin configuration page

Open the **dsh-zotero** detail page in the plugin manager; its configuration area carries the full 7-tab form (through the harness's official `SettingsForm` and `SettingsFormModel`) and edits the `zotero`, `library`, `scholarly`, and `parsing` namespaces in one place:

- Edits are written to the `config` override on the matching entry in the current profile's `cordis.patch.yml`;
- Saves take effect at once: transport configuration and write-gate changes rebuild the matching components inside the service instance, and pure limit fields are read live by the provider;
- Invalid configuration is refused before the write, and the configuration page keeps the valid draft;
- Fields explicitly set by the override layer show a marker and can be reset in one click;
- Form writes are revision-fenced (a stale draft is refused); a write that a home patch or command-line overlay would override does not land either.

The same form state has two more entry points, and the three relate as follows:

1. Unified settings page tabs: the 7-tab form in the plugin detail page's configuration area;
2. Component row configuration: the "Configure" button on the `dsh-zotero#library`, `dsh-zotero#scholarly`, and `dsh-zotero#parsing` rows under "Included components", each editing its own namespace;
3. Configuration file: edit `config` on the matching entry in the current profile's `cordis.patch.yml` directly.

The first two are two views of one `ConfigForm` state, synced live over both channels; the third is the configuration override layer, which a form write takes as its highest priority. While a component row is not composed, the matching tab of the settings page shows only a disabled pointer to "Included components" and renders no field, and the component row configuration entry is not registered either.

## Hot reload behavior

- When transport configuration or a write gate changes, the HTTP client, local provider, and write tool set are rebuilt on the same `ZoteroService` instance;
- Limit configuration changes are read by the provider on the next call, with no transport rebuild;
- The `webEnabled` toggle shows or hides the literature trail tab immediately after saving;
- The `rightSidebarEnabled` toggle shows or hides the right-sidebar literature panel immediately after saving;
- The `debug` toggle takes effect immediately after saving and controls the diagnostics panel at the bottom of the detail page and diagnostic log retention, with no component reinitialization;
- Every other configuration update applies on the next tool call, with no host restart.

## Environments without a settings service

In a headless environment with no settings service, the plugin runs on the entry configuration passed at composition time.

---

## Scholarly component configuration (`dsh-zotero/scholarly`)

The component ships with the package and is off by default. Its only switch is the `dsh-zotero/scholarly` row under "Included components" in the plugin manager: enabling that row mounts the component, registers its 7 model tools, and permits external requests — index searches go only to the explicitly allowlisted external academic indexes, and the open-access PDF fulltext arm is the single exception (any public HTTP(S) host under the two-gate public-address check). While the component is not mounted, its service, transport, and tools do not exist, so no scholarly retrieval request can be issued; the equivalent hand edit is `- id: scholarly` plus `disabled: false` in the current profile's `cordis.patch.yml`. The authorization boundary for external retrieval is in the "four boundaries" section of [Product model](product-model.en.md).

Component fields have three entry points: the "Scholarly Search" tab of the unified settings page, the "Configure" button on the `dsh-zotero#scholarly` row in the plugin list, or `config` on that row in the current profile's `cordis.patch.yml`. The first two are two views of one form state, synced live over both channels; the third is the configuration override layer. A field change applies on the next tool call, with no profile restart:

| Field                   | Default | Description                                                                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`                 | none    | Contact email, attached to Crossref, OpenAlex, and NCBI/Europe PMC request headers (joins the Polite Pool for a better rate-limit quota)          |
| `s2ApiKeyEnv`           | `''`    | Credential reference for the Semantic Scholar API key (suggested `S2_API_KEY`); empty disables the key and its shared-pool rate-limit relief      |
| `ncbiApiKeyEnv`         | `''`    | Credential reference for the NCBI / PubMed API key (suggested `NCBI_API_KEY`); empty disables the key that raises the per-second cap from 3 to 10 |
| `openalexApiKeyEnv`     | `''`    | Credential reference for the OpenAlex API key (suggested `OPENALEX_API_KEY`); empty disables the key that raises the per-second cap to 100        |
| `maxResults`            | `20`    | Maximum number of papers one search returns (1-100)                                                                                               |
| `maxContentChars`       | `12000` | Character cap for chunked full-text reading (1,000-50,000)                                                                                        |
| `enableRunInBackground` | `true`  | Whether `scholarly_read` / `scholarly_search` / `scholarly_verify` may run as an explicit background job                                          |
| `promoteOnTimeout`      | `true`  | Whether a foreground wait that exceeds the timeout is promoted to a background job                                                                |
| `foregroundWaitMs`      | `30000` | Foreground wait in milliseconds before promotion (1-240,000)                                                                                      |

While the component is off, the "Scholarly Search" tab of the settings page shows only a pointer to "Included components" and renders no field, and the component row configuration entry is not registered; once the component is on, the tab becomes an editable form. Full texts are cached under `$DSH_HOME/cache/zotero-scholarly/` as one JSON body per key (not controlled by this table, and with no separate switch).

Where key values live: configuration stores only reference names. The three password controls under "Scholarly Search → identity and credential references" write the typed key into the host credentials store (the credentials seam); the value never enters the configuration. A configured reference that does not resolve fails the tool call instead of degrading to anonymous access.

Upgrading from an older build: the literal fields `s2Key` / `ncbiKey` / `openalexKey` were removed from the schema. A profile that still carries them is refused when the component mounts, with an error that names the fields and the migration. Remove them from the profile's `cordis.patch.yml`, re-enter each key in the matching password control (suggested references `S2_API_KEY` / `NCBI_API_KEY` / `OPENALEX_API_KEY`), and rotate the old key: it was stored as plaintext configuration and is not migrated automatically.

---

## Literature panel component configuration (`dsh-zotero/library`)

The literature panel is an independent DSH bundle subcomponent. It ships with the package and is enabled in the default profile (`cordis.patch.yml` includes `- id: library` / `name: dsh-zotero/library`). It offers whole-library browsing, search, item inspection, and citation copying, shown as a right-sidebar tab beside the conversation.

Component fields have three entry points:

1. Unified settings page, "Literature panel" tab: switch to "Literature panel" in the 7-tab form of the plugin detail page;
2. Included components row configuration: click the "Configure" button on the `dsh-zotero#library` row under "Included components";
3. Configuration file: declare it under `config` on the matching entry in the current profile's `cordis.patch.yml`.

The first two are two views of one form state, synced live over both channels; the third is the configuration override layer.

| Field                    | Default                   | Values and behavior                                                                                           |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `rightSidebarEnabled`    | `true`                    | Show the panel and shortcuts independently of the literature trail                                            |
| `listDensity`            | `comfortable`             | `comfortable` / `compact`, using standard / compact host button density                                       |
| `titleLines`             | `2`                       | `1` / `2`; hover reveals the complete title                                                                   |
| `detailExpandedSections` | `[abstract, attachments]` | Unique subset of `abstract`, `attachments`, `notes`, `annotations`; an empty array collapses all              |
| `localPdfOpenTarget`     | `sidebar`                 | `sidebar` / `float` / `zotero`                                                                                |
| `urlPdfOpenTarget`       | `sidebar`                 | `sidebar` / `float`, after host validation and download                                                       |
| `allowUrlPdfRead`        | `false`                   | Independent external reading permission, acknowledged before enabling; does not require scholarly             |
| `reopenBehavior`         | `restore`                 | `restore` resumes the position; `allItems` starts at personal-library All items on a new tab or page reload   |
| `scopeChangeBehavior`    | `preserve`                | `preserve` / `clear`; applies to query and extra filters between collections and All items in one library     |
| `defaultCopyFormat`      | `citation`                | `citation` / `bibliography` / `bibtex` / `biblatex` / `ris` / `csljson` / `csv` / `itemInfo`                  |
| `chatInsertContent`      | `reference`               | `reference` inserts item information; `referenceAndAbstract` adds the abstract with missing/truncated markers |

Both settings entrances share staged edits, save, discard and reset-to-inherited behavior. The live panel consumes accepted settings only. Display, disclosure defaults and actions update immediately without remounting the component; manual disclosure changes for the current item take precedence. Choosing a copy-menu format affects that operation only. CSL style and language reuse core `defaultStyle` / `defaultLocale`. Their complete editors now live in the Literature panel’s Citation defaults group, with direct save and per-field reset. This group saves independently without submitting unsaved changes from other tabs. General no longer displays these two fields.

Browsing positions use v3 storage, isolated by browser, Zotero `serverId` and conversation. Records retain library, scope, query, mode, sorting, filters, page, expanded prefixes, selected item, narrow pane and scroll positions, without directory payloads. Temporary hiding, switching conversations and opening a reader preserve the current tab even under `allItems`. Clear a conversation's browsing position from the panel tab menu; resetting inherited configuration is separate. Storage failures show an inline error and reset action. Changing libraries, saved searches or Trash always clears query and extra filters while preserving mode and sorting.

URL PDF reading accepts only a qualified attachment ref belonging to the current local Zotero instance. The service resolves the URL itself and accepts no arbitrary URL input. Every host passes public-address and DNS checks, connections use the pinned answers, and every redirect is revalidated with HTTPS downgrade refused. Requests carry no browser cookies, credentials or Referer. Downloads are limited to 32 MiB, 60 seconds, 5 redirects and 2 concurrent reads; media type and PDF signature are checked. Failures never return partial files or retry automatically; revoking permission cancels active downloads. Complete PDFs are staged in private random temporary directories and opened through the public host file reader in the owning session's sidebar or floating panel. Closing the last reader or unloading the plugin releases its file; at most 16 reading files are retained. Saving settings and restoring tabs never initiates an external download. The browser retains the attachment source ref; a restored reader offers an explicit Reload PDF tab-menu action that revalidates permission and source before replacing the original session tab. Download URLs are never persisted. This permission enables no external index searches, Agent tools or scholarly prompt section.

The panel requires a composed component row and `rightSidebarEnabled`; `webEnabled` controls only the literature trail. Without the component, no panel surface or endpoint call exists. Panel writes retain the core approval seam and require the owning session to be running.

---

## Document parsing component configuration (`dsh-zotero/parsing`)

Document parsing is a separate DSH bundle sub-component, shipped with the package but disabled by default (`cordis.patch.yml` contains `- id: parsing` / `name: dsh-zotero/parsing` / `disabled: true`). Enabling that row authorizes the component to contact MinerU; it registers no model tools and no prompt section. It feeds `zotero_retrieve` and `scholarly_read` through one optional full-text enhancer slot on the core service, producing higher-quality Markdown from PDFs. While the component is unmounted the slot is empty and both read paths keep their original local-extraction behavior unchanged.

Sending document bytes additionally needs the component's own data-egress authorization, `allowParsingUpload` (off by default; the form asks for confirmation before enabling). MinerU receives PDF bytes only while both authorizations hold. Every external request is issued by this component; the core holds no MinerU transport, host table, or credentials.

The component's fields have three entry points:

1. **Unified settings page "Document Parsing" tab**: switch to it in the plugin detail page's 7-tab form;
2. **Included-components row configuration**: the "Configure" button on the `dsh-zotero#parsing` row;
3. **Configuration file**: declare them under `config` on that entry in the current profile's `cordis.patch.yml`.

| Field                | Default | Values and behavior                                                                                                                                                                                                                                                          |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`               | `free`  | `free` uses the token-free Agent lightweight API (IP rate-limited, API-side ≤10 MB and ≤20 pages); `pro` uses the precise API (API-side ≤200 MB and ≤600 pages) and needs a token. Page counts and API byte caps are enforced by MinerU; the client does not pre-check pages |
| `mineruTokenRef`     | `''`    | Credential reference name for the MinerU precise-API token (suggested `MINERU_API_TOKEN`); resolved only in `pro` mode, and `free` mode does not resolve the credential                                                                                                      |
| `allowParsingUpload` | `false` | Data-egress authorization: whether local attachment and URL-PDF bytes may be sent to MinerU; independent of mounting the component                                                                                                                                           |
| `outputDir`          | `''`    | Absolute directory for parsed artifacts (or a `~/...` path); empty resolves the default `~/.dsh/zotero-parsed` at runtime. A relative path is refused by the schema/form                                                                                                     |

The mode switch is fully decoupled from the token: `mode` is its own field, the host dispatches on it, and `free` never resolves the token credential, so a user who configured one can still switch back to the free API. When `mode` is `pro` and `mineruTokenRef` does not resolve, the call fails closed with `ZOTERO_PARSING_CREDENTIAL_UNRESOLVED`; it never silently degrades to the free API or an anonymous request.

Parsed artifacts are written to `<outputDir>/<sha256>/` keyed by a content fingerprint (source, mode, and the SHA-256 of the PDF bytes): `full.md`, `meta.json` (source, mode, task ID, file list, plus pages only when `pro` returned `total_pages`), and `content_list.json` for the precise API. `meta.json` is written last and acts as the completeness marker.

The cache has two levels: content artifacts by fingerprint, and a source index at `<outputDir>/sources/<sha256>/` mapping `identity + mode` to an artifact and a source stamp. A local attachment is only `stat`ed (size and mtime); a change falls back to the content fingerprint. A URL source receives one token-free HEAD and is compared by `ETag`/`Last-Modified`/`Content-Length`; a match reads the local artifact **without downloading the PDF or contacting MinerU**, while a mismatch or a failed HEAD falls back to the URL identity or a fresh download. The raw URL's query and fragment are not written to `meta.json` (origin and path only). Deleting the matching entry under `<outputDir>/sources` forces a re-parse.

The output directory is fully validated on first use: a relative path is refused by the schema/form; a missing, unwritable, sensitive system path (including macOS `/private/etc` and `/private/var`, and `~/.ssh`/`~/.gnupg`), or a symlink escape fails **fatally** with `ZOTERO_PARSING_OUTPUT_INVALID` and does not fall back. The free API's size cap (>10 MiB) falls back to local extraction with `ZOTERO_PARSING_UNSUPPORTED_INPUT` in the reason, never a silent truncation.

The default parse budget is 30 minutes with 900 polls (one every 2 seconds); submit and one poll get 60 seconds, the signed upload 20 minutes, the result download 10 minutes, a source PDF transfer 20 minutes, and a cache HEAD 15 seconds. Parsed Markdown below 500 characters is treated as a fallback; identical bytes are parsed once per `ParsingService`, and one caller's cancellation does not cancel the other waiters.

Error classification:

| Code                                   | Class    | Behavior                                                                                |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `ZOTERO_PARSING_CREDENTIAL_UNRESOLVED` | fatal    | The pro token reference does not resolve; the read fails                                |
| `ZOTERO_PARSING_OUTPUT_INVALID`        | fatal    | The output directory is unusable; the read fails and no document bytes are sent         |
| `ZOTERO_PARSING_TASK_FAILED`           | fallback | Submit/task/poll failure or timeout; local extraction                                   |
| `ZOTERO_PARSING_ARCHIVE_INVALID`       | fallback | Malformed or unsafe result zip; local extraction                                        |
| `ZOTERO_PARSING_UNSUPPORTED_INPUT`     | fallback | Over the selected API's byte cap or not a PDF; local extraction with the code preserved |

With `allowParsingUpload` off, no new document bytes are sent and the read falls back locally; an existing local artifact remains readable. Only credential resolution and an unusable output directory fail closed; other runtime failures fall back with a stated reason recorded in the diagnostics ring.
