<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# Configuration Reference

dsh-zotero configuration is split across four settings namespaces. Each namespace gets its field defaults from its own Schemastery schema and is validated on load or save; an invalid value blocks plugin loading or that namespace's configuration write.

- Core `zotero` namespace: `src/config.ts`, 37 fields, runtime validation by `resolveConfig`;
- Literature panel `library` namespace: `src/library/config.ts`, 11 fields;
- Scholarly search `scholarly` namespace: `src/scholarly/config.ts`, 9 fields;
- Document parsing `enrichment` namespace: `src/enrichment/config.ts`, 8 fields.

The four groups total 65 fields. Every field is declared `volatile`, and a configuration write lands under `config` on the matching entry (`zotero` / `library` / `scholarly` / `enrichment`) in the current profile's `cordis.patch.yml`.

## Settings tabs and field ownership

The configuration area of the plugin detail page is a 7-tab form that edits all four namespaces at once. Tabs, namespaces, and fields line up as follows:

| Tab                 | Settings namespace  | Fields | Groups and fields                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General             | `zotero`            | 6      | Literature trail: `webEnabled`; Writing: `writeEnabled`, `writePersistKey`, `writeNoteMaxChars`, `writeListMaxItems`, `writeAuthorizeDeadlineMs`                                                                                                                                                                                        |
| Connection          | `zotero`            | 5      | Connection: `baseUrl`, `provider`, `timeoutMs`, `maxInFlightRequests`, `scopeListingTtlMs`                                                                                                                                                                                                                                              |
| Search & Extraction | `zotero`            | 13     | Search & Concurrency: `maxSearchResults`, `maxNoteScanRecords`, `searchConcurrency`, `graphConcurrency`, `retrieveAttachmentCap`; Passages & Fulltext Extraction: `maxEvidenceChars`, `maxEvidencePassages`, `maxNoteChars`, `maxNoteRecords`, `maxAnnotationRecords`, `maxAttachmentRecords`, `fulltextChunkWords`, `maxFulltextChars` |
| Literature panel    | `library`, `zotero` | 13     | 11 panel preferences for display, details, browsing, PDF reading, citations and conversation; citation defaults: `defaultStyle`, `defaultLocale`                                                                                                                                                                                        |
| Scholarly Search    | `scholarly`         | 9      | Identity and credential references: `email`, `s2ApiKeyEnv`, `ncbiApiKeyEnv`, `openalexApiKeyEnv`; Search & Full-text Quotas: `maxResults`, `maxContentChars`; Background tasks: `enableRunInBackground`, `promoteOnTimeout`, `foregroundWaitMs`                                                                                         |
| Document Enrichment | `enrichment`        | 8      | Mode and output: `mode`, `mineruTokenRef`, `outputDir`; Semantic ranking: `enableSemanticSearch`, `semanticModel`, `semanticDownloadSource`, `semanticModelDir`; Deployment limits: `artifactReader`                                                                                                                                    |
| Advanced            | `zotero`            | 11     | Output limits: `maxInlineResultTokens`, `maxInlineResultBytes`, `maxResponseBytes`, `maxExportChars`, `maxExportRefs`, `maxBrowseResults`, `maxChangesResults`; Background tasks: `enableRunInBackground`, `promoteOnTimeout`, `foregroundWaitMs`; Diagnostics: `debug`                                                                 |

`webEnabled` sits under "General → Literature trail", and the toggle is named "Show literature trail"; it decides whether the literature trail tab appears at the top of the conversation. The literature panel also needs the `dsh-zotero/library` component row to be composed and this component's `rightSidebarEnabled` to be on, as described below in "Literature panel component configuration".

## Core fields (`zotero`, 37)

| Field                      | Default                      | Description                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API address; must be loopback HTTP with a `/api` path prefix (`localhost` resolves to `127.0.0.1` at runtime)                                                                                                                           |
| `provider`                 | `local`                      | Selected provider identifier                                                                                                                                                                                                                         |
| `timeoutMs`                | `5000`                       | Timeout for a single HTTP request (ms)                                                                                                                                                                                                               |
| `maxInFlightRequests`      | `8`                          | Cap on concurrent in-flight requests to the Local API                                                                                                                                                                                                |
| `maxSearchResults`         | `20`                         | Cap on items returned by `zotero_search`; also clamps the literature panel's search page size (the response carries the effective `limit`)                                                                                                           |
| `maxNoteScanRecords`       | `200`                        | Cap on note records scanned when searching note content                                                                                                                                                                                              |
| `searchConcurrency`        | `4`                          | Concurrency for parent attribution queries in `zotero_search`                                                                                                                                                                                        |
| `maxEvidenceChars`         | `6000`                       | Total character budget for retrieved passages                                                                                                                                                                                                        |
| `maxEvidencePassages`      | `4`                          | Cap on the number of retrieved passages                                                                                                                                                                                                              |
| `maxNoteChars`             | `2000`                       | Panel childPage preview budget; full tool bodies are unchanged                                                                                                                                                                                       |
| `maxNoteRecords`           | `50`                         | Maximum notes per explicit page; full reads are uncapped                                                                                                                                                                                             |
| `maxAnnotationRecords`     | `100`                        | Maximum annotations per explicit page; full reads are uncapped                                                                                                                                                                                       |
| `maxAttachmentRecords`     | `50`                         | Maximum attachments per explicit page; full reads are uncapped                                                                                                                                                                                       |
| `fulltextChunkWords`       | `200`                        | Words per full-text chunk that enters the ranking                                                                                                                                                                                                    |
| `maxFulltextChars`         | `250000`                     | Maximum full-text characters one `zotero_retrieve` call accepts (split evenly across multiple attachments)                                                                                                                                           |
| `retrieveAttachmentCap`    | `16`                         | Cap on attachments that join full-text ranking in one `zotero_retrieve` call                                                                                                                                                                         |
| `graphConcurrency`         | `4`                          | Concurrency for attachment reads in `zotero_retrieve`                                                                                                                                                                                                |
| `maxInlineResultTokens`    | `4000`                       | Official Harness token estimate limit for both canonical and rendered inline results; positive safe integer.                                                                                                                                         |
| `maxInlineResultBytes`     | `65536`                      | Independent serialized inline byte limit; exceeding either budget requires durable file delivery.                                                                                                                                                    |
| `maxResponseBytes`         | `16777216`                   | Streaming byte cap for a single API response (16 MiB)                                                                                                                                                                                                |
| `maxExportChars`           | `1000000`                    | Hard character cap on export output (1,000,000 characters)                                                                                                                                                                                           |
| `maxExportRefs`            | `50`                         | Ref cap for a single `zotero_export` call; the literature panel's `zotero/export` endpoint shares this cap                                                                                                                                           |
| `maxBrowseResults`         | `50`                         | Cap on items returned by a single `zotero_browse` call; also clamps the literature panel's browse page size (collection tree / tags / saved searches, the response carries the effective `limit`)                                                    |
| `maxChangesResults`        | `50`                         | Cap on items listed per resource kind in `zotero_changes` (presentation only)                                                                                                                                                                        |
| `scopeListingTtlMs`        | `30000`                      | How long a collection or search scope listing is trusted before it is read again (ms)                                                                                                                                                                |
| `defaultStyle`             | `apa`                        | CSL citation style (must be built into Zotero); used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                                  |
| `defaultLocale`            | `en-US`                      | CSL citation locale; used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                                                             |
| `writeEnabled`             | `false`                      | Whether to register and enable personal library write tools                                                                                                                                                                                          |
| `writePersistKey`          | `true`                       | Whether Always-Allow write keys are stored in the host credentials manager; a stored grant can be revoked from the settings page's Writing group                                                                                                     |
| `writeNoteMaxChars`        | `65536`                      | Character cap for one research note body                                                                                                                                                                                                             |
| `writeListMaxItems`        | `50`                         | Item cap for list-shaped write arguments: `add`/`remove` on `update_item_tags`/`update_item_collections`, `tags` on `delete_library_tags`, and `collections`/`tags`/`sourceRefs` on `create_note`                                                    |
| `writeAuthorizeDeadlineMs` | `120000`                     | Time limit for waiting on the Zotero authorization dialog during a write (ms)                                                                                                                                                                        |
| `webEnabled`               | `true`                       | Whether to show the literature trail tab at the top of the conversation                                                                                                                                                                              |
| `enableRunInBackground`    | `true`                       | Whether requests with `run_in_background: true` may run in the background (`zotero_export` / `zotero_changes` declare the parameter only while this is on and a `jobs` service is composed; an undeclared `true` still returns a structured refusal) |
| `promoteOnTimeout`         | `true`                       | Whether a foreground export or changes sync that times out is promoted to a background job                                                                                                                                                           |
| `foregroundWaitMs`         | `4000`                       | Foreground wait limit (ms), after which the operation is promoted to a background Job                                                                                                                                                                |
| `debug`                    | `false`                      | Whether diagnostic mode is on; when on, it shows the diagnostics panel at the bottom of the plugin detail page and records request paths and tool-call details; logs stay in process memory only and are never written to disk or sent out           |

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

Open the **dsh-zotero** detail page in the plugin manager; its configuration area carries the full 7-tab form (through the harness's official `SettingsForm` and `SettingsFormModel`) and edits the `zotero`, `library`, `scholarly`, and `enrichment` namespaces in one place:

- Edits are written to the `config` override on the matching entry in the current profile's `cordis.patch.yml`;
- Saves take effect at once: transport configuration and write-gate changes rebuild the matching components inside the service instance, and pure limit fields are read live by the provider;
- Invalid configuration is refused before the write, and the configuration page keeps the valid draft;
- Fields explicitly set by the override layer show a marker and can be reset in one click;
- Form writes are revision-fenced (a stale draft is refused); a write that a home patch or command-line overlay would override does not land either.

The same form state has two more entry points, and the three relate as follows:

1. Unified settings page tabs: the 7-tab form in the plugin detail page's configuration area;
2. Component row configuration: the "Configure" button on the `dsh-zotero#library`, `dsh-zotero#scholarly`, and `dsh-zotero#enrichment` rows under "Included components", each editing its own namespace;
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

The component ships with the package and is off by default. Its only switch is the `dsh-zotero/scholarly` row under "Included components" in the plugin manager: enabling that row mounts the component, registers its 7 model tools, and permits external requests — index searches go only to the explicitly allowlisted external academic indexes, and the open-access PDF fulltext arm is the single exception (any public HTTP(S) host under the two-gate public-address check; the local proxy's fake-IP placeholders are accepted only for allowlisted index hosts and HTTPS fulltext targets, identified by the reviewed hostname and TLS, while plain-HTTP targets still require a validated public address). While the component is not mounted, its service, transport, and tools do not exist, so no scholarly retrieval request can be issued; the equivalent hand edit is `- id: scholarly` plus `disabled: false` in the current profile's `cordis.patch.yml`. Once enabled, the client shows the external-retrieval disclosure while this browser has not acknowledged the current enable; the acknowledgement covers that one enable, so turning the component off and on again shows it again. The authorization boundary for external retrieval is in the "four boundaries" section of [Product model](product-model.en.md).

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

## Document parsing component configuration (`dsh-zotero/enrichment`)

Content enrichment is a separate DSH bundle sub-component, shipped with the package and disabled by default (`cordis.patch.yml` contains `- id: enrichment` / `name: dsh-zotero/enrichment` / `disabled: true`). Enabling the component accepts MinerU document egress and provides three capabilities: user-submitted document parsing, read-only reuse of valid same-source artifacts, and local semantic ranking with model management. Mounting starts no upload, and the client discloses the egress while the component is served until this browser acknowledges the current enable; turning the component off and on again discloses again. It registers no model tools and no prompt section. Ordinary reads use the core's read-only `FulltextEnhancer.lookup` slot to reuse a valid artifact; on a miss they keep the Zotero fulltext index or authorized local PDF extraction. With the component disabled the slot is empty and both read paths keep their original behavior.

A MinerU parse requires the user to submit one specific Zotero PDF attachment (child or top-level) or one public PDF URL and to pass remote-action and session access checks. Opening a PDF, saving settings, and starting the service do not submit, resume, or upload a MinerU task. Local semantic ranking makes no MinerU call; parsing needs no semantic model. An old `allowDocumentUpload` value in a profile is ignored.

The component's fields have three entry points:

1. **Unified settings page "Document Enrichment" tab**: switch to it in the plugin detail page's 7-tab form;
2. **Included-components row configuration**: the "Configure" button on the `dsh-zotero#enrichment` row;
3. **Configuration file**: declare them under `config` on that entry in the current profile's `cordis.patch.yml`.

| Field                    | Default              | Values and behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`                   | `free`               | `free` uses the token-free Agent Lightweight Parse API (IP rate-limited, API-side ≤10 MB and ≤20 pages); `pro` uses the Precision Extract API (API-side ≤200 MB and ≤200 pages) and needs a token (5,000 free files/day, rate limits: 50 files/min submit, 1,000 req/min query). Page counts and API byte caps are enforced by MinerU; the client does not pre-check pages                                                                                                     |
| `mineruTokenRef`         | `'MINERU_API_TOKEN'` | Credential reference name for the MinerU precise-API token (defaults to plugin-dedicated `MINERU_API_TOKEN`); resolved in `pro` mode from the credentials store (tokens are valid for 3 months). The UI uses this default automatically without manual entry                                                                                                                                                                                                                   |
| `outputDir`              | `''`                 | Absolute directory for parsed artifacts (or a `~/...` path); empty resolves the default `~/.dsh/zotero-parsed` at runtime. A relative path is refused by the schema/form                                                                                                                                                                                                                                                                                                       |
| `enableSemanticSearch`   | `false`              | Whether to enable local semantic ranking: off means complete BM25; on but model/runtime unavailable fails the read explicitly, never a BM25 fallback                                                                                                                                                                                                                                                                                                                           |
| `semanticModel`          | `'balanced'`         | Selected local embedding model tier: `balanced` (general-purpose balanced, backed by Qwen3-0.6B, recommended default), `lightweight` (ultra-lightweight, backed by Granite-97M, RAM <250MB), `bilingual` (Chinese-English, backed by KaLM-0.5B, instruction-tuned), `english` (English long-context, backed by Nomic-137M, 8K context), `hybrid` (multi-vector dense/sparse, backed by BGE-M3), `academic` (classic multilingual baseline, backed by GTE-Base, 768 dimensions) |
| `semanticDownloadSource` | `'hf-mirror'`        | Download channel / mirror: `hf-mirror` (hf-mirror.com, recommended in China), `huggingface` (huggingface.co)                                                                                                                                                                                                                                                                                                                                                                   |
| `semanticModelDir`       | `''`                 | Custom absolute directory for downloaded models (or a `~/...` path); empty uses the default `~/.dsh/models/`                                                                                                                                                                                                                                                                                                                                                                   |
| `artifactReader`         | See below            | Deployment limits for complete document preparation, read snapshots and ZIP workers; configured in the profile                                                                                                                                                                                                                                                                                                                                                                 |

Each `artifactReader` value must be a positive integer. New limits apply to subsequent admissions; an admitted snapshot retains its policy.

| Field                | Default     | Behavior                                                          |
| -------------------- | ----------- | ----------------------------------------------------------------- |
| `maxOpen`            | `8`         | Concurrent Host read snapshots                                    |
| `maxBytes`           | `268435456` | Host snapshot budget, 256 MiB                                     |
| `preparedMaxBytes`   | `536870912` | Browser complete documents and refresh candidates, 512 MiB        |
| `idleTimeoutMs`      | `120000`    | Snapshot idle deadline                                            |
| `maxLifetimeMs`      | `600000`    | Maximum snapshot lifetime                                         |
| `concurrency`        | `4`         | Browser page and figure request concurrency                       |
| `archiveConcurrency` | `2`         | Concurrent result download, extraction and persistence operations |
| `archiveQueueLimit`  | `8`         | Waiting archive operations                                        |

When capacity is exhausted, the UI shows a retryable error. A complete document holds its browser budget until its parsed tab closes, and a failed refresh keeps the previous complete result.

`mode` is its own field and the host dispatches on it; `free` does not resolve the token credential, so a user who configured one can switch back to the free API. When `mode` is `pro` and `mineruTokenRef` does not resolve, the call fails with `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`, without degrading to the free API or an anonymous request.

### Local Semantic Search & Model Download

ONNX embedding models require manual download before enabling. Models are addressed through semantic tier keys, decoupled from physical model versions so configurations stay valid across upgrades:

- **Model Tiers**:
  - `balanced` (General & Balanced · currently backed by `Qwen3-Embedding-0.6B` · ~625 MB, 1024 dimensions, 32K max tokens, Apache 2.0): Open-source embedding model, C-MTEB Chinese overall 66.33 / retrieval 71.03, 100+ languages, 32K context. Default tier.
  - `lightweight` (Ultra-Lightweight · currently backed by `IBM Granite 97M ModernBERT` · ~123 MB, 384 dimensions, 32K max tokens, Apache 2.0): Memory footprint <250 MB, millisecond CPU latency, for resource-constrained or high-throughput batch environments.
  - `bilingual` (Bilingual Literature · currently backed by `KaLM-Embedding-multilingual-mini-instruct-v2.5` · ~574 MB, 896 dimensions, 32K max tokens, Apache 2.0): Instruction-tuned for English/Chinese mixed retrieval and literature search.
  - `english` (English Long-Context · currently backed by `nomic-embed-text-v1.5` · ~141 MB, 768 dimensions, 8192 max tokens, Apache 2.0): Open weights and data, 8K context with dynamic Matryoshka dimension truncation, for English and academic text.
  - `hybrid` (Multi-Vector Hybrid · currently backed by `BAAI BGE-M3` · ~585 MB, 1024 dimensions, 8192 max tokens, Apache 2.0): Academic benchmark for multi-lingual literature and review-paper recall.
  - `academic` (Classic Academic · currently backed by `gte-multilingual-base` · ~357 MB, 768 dimensions, 8192 max tokens, Apache 2.0): Multilingual academic baseline across 75+ languages.
- **Hardware and architecture**:
  - On 16GB RAM CPU-only machines, the OS and environment use 6~8GB, leaving 1.5GB~2.5GB for computation. Models are limited to 97M~600M parameters; **4B and 8B models are excluded** (they need 4.5~8.5GB even with INT8 quantization, giving multi-second query latency and risking swap thrashing or OOM termination).
  - Retrieval uses Reciprocal Rank Fusion (RRF, k=60) to combine BM25 lexical ranking and dense vector similarity, without a Cross-Encoder reranker.
- **Multiple Download Channels**:
  - `hf-mirror` (`https://hf-mirror.com`): Mirror for direct downloads in mainland China;
  - `huggingface` (`https://huggingface.co`): Official Hugging Face repository for direct international access or configured proxies.
- **Download Command (CLI)**:
  Run in terminal:
  ```sh
  npm run assets:semantic -- --model=<key> --source=<source>
  ```
  The script verifies SHA-256 and byte counts for every file. After download, enable "Enable local semantic search" in settings. With semantic search off, ranking uses complete BM25; with it on but the model missing, corrupt, or its runtime unavailable, the read fails with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`, with no BM25 fallback.
- **Interactive Configuration Guidance**:
  - **Semantic search enabled without downloaded model**: When the selected model is not ready (including after settings are saved), the form shows a persistent warning stating that reads fail with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`. The user can select a model and click "Download model", or turn semantic search off to use BM25. The warning clears once the model is ready.
  - **Deleting a local model**: When a model is installed or fails verification, the model status row shows "Delete model". Confirming removes the local model files; semantic search stays unavailable until the model is downloaded again.
  - **Precision Extract selected without Token**: When "Precision Extract" is selected without a configured MinerU API Token, the credential section shows a notice. Switch to the token-free "Agent Lightweight Parse" mode, or paste a token created on `mineru.net`. The website link stays visible; a configured token appears as asterisks, and entering a new value and saving replaces it.

Parsed artifacts are written to `<outputDir>/<sha256>/` keyed by a content fingerprint (source, mode, and the SHA-256 of the PDF bytes): `full.md`, `meta.json` (source, mode, task ID, file list, plus pages only when `pro` returned `total_pages`), and `content_list.json` for the precise API. `meta.json` is written last and acts as the completeness marker.

The cache has two levels: fingerprinted artifacts and a source index at `<outputDir>/sources/index.json` keyed by the canonical source's SHA-256; `mode` lives in the artifact meta and the content cache key. Local files compare size and mtime. URL sources receive a token-free HEAD and require a matching ETag or matching Last-Modified plus Content-Length, with no contradictory shared validators. A source without useful validators is fetched and checked by its byte fingerprint; probe failures are explicit errors. A valid hit reads local artifacts without downloading a PDF or contacting MinerU. URL provenance metadata retains only the origin.

Private task receipts at `<outputDir>/tasks/<sha256>.json` use file mode `0600`. Upload completion removes the signed URL from the receipt. A later read resumes the same task after polling/download failure, cancellation, or restart. Unuploaded URLs expire after 24 hours; expiration and terminal task failures report an error and clear the receipt, allowing a new task on the next explicit read; successful artifact persistence also clears it. POST submissions are not retried; GET/HEAD/PUT retry transient failures at most twice, honoring `Retry-After` and phase/total deadlines.

The output directory is validated on first use: the schema/form refuses a relative path; a missing, unwritable, sensitive system path (including macOS `/private/etc` and `/private/var`, and `~/.ssh`/`~/.gnupg`), or a symlink escape fails with `ZOTERO_ENRICHMENT_OUTPUT_INVALID`. An input over the free API's size cap (>10 MiB) fails with `ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT`, without truncation.

The default parse budget is 30 minutes with 900 polls (one every 2 seconds); submit and one poll get 60 seconds, the signed upload 20 minutes, the result download 10 minutes, a source PDF transfer 20 minutes, and a cache HEAD 15 seconds. Valid short documents retain their parsed content; empty text, HTML/XML error pages, invalid UTF-8, and malformed content lists fail with an error. Identical bytes are parsed once per `EnrichmentService`; one caller's cancellation does not cancel the other waiters.

Error classification:

| Code                                      | Class | Behavior                                                                                                       |
| ----------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED` | fatal | The pro token reference does not resolve; the read fails                                                       |
| `ZOTERO_ENRICHMENT_OUTPUT_INVALID`        | fatal | The output directory is unusable; the read fails and no document bytes are sent                                |
| `ZOTERO_ENRICHMENT_TASK_FAILED`           | fatal | Submit/task/poll failure or timeout; read fails                                                                |
| `ZOTERO_ENRICHMENT_ARCHIVE_INVALID`       | fatal | Malformed or unsafe result zip; read fails                                                                     |
| `ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT`     | fatal | Over the selected API's byte cap or not a PDF; read fails with its code preserved                              |
| `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`  | fatal | Semantic ranking on but the model is missing, corrupted, or inference failed; read fails, no lexical degrade   |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED` | fatal | The model download failed on every mirror; the settings page shows the reason                                  |
| `ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED`   | fatal | Model removal failed or hit an unsafe path; local files may remain and the error is explicit                   |
| `ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE`      | fatal | No session-owned jobs controller or live session; a submitted parse cannot start and the read fails explicitly |
| `ZOTERO_ENRICHMENT_OPERATION_CONFLICT`    | fatal | An operation id was replayed against a different target or settings snapshot; the operation is refused         |

All parsing failures propagate to the caller without substituting local extraction or another API mode.
