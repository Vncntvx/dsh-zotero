<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# Configuration Reference

dsh-zotero configuration is split across three settings namespaces. Each namespace gets its field defaults from its own Schemastery schema and is validated on load or save; an invalid value blocks plugin loading or that namespace's configuration write.

- Core `zotero` namespace: `src/config.ts`, 37 fields, runtime validation by `resolveConfig`;
- Literature panel `library` namespace: `src/library/config.ts`, 1 field;
- Scholarly search `scholarly` namespace: `src/scholarly/config.ts`, 6 fields.

The three groups total 44 fields. Every field is declared `volatile`, and a configuration write lands under `config` on the matching entry (`zotero` / `library` / `scholarly`) in the current profile's `cordis.patch.yml`.

## Settings tabs and field ownership

The configuration area of the plugin detail page is a 6-tab form that edits all three namespaces at once. Tabs, namespaces, and fields line up as follows:

| Tab                 | Settings namespace | Fields | Groups and fields                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General             | `zotero`           | 8      | Literature trail: `webEnabled`; Writing: `writeEnabled`, `writePersistKey`, `writeNoteMaxChars`, `writeListMaxItems`, `writeAuthorizeDeadlineMs`; Citation defaults: `defaultStyle`, `defaultLocale`                                                                                                                                                                          |
| Connection          | `zotero`           | 5      | Connection: `baseUrl`, `provider`, `timeoutMs`, `maxInFlightRequests`, `scopeListingTtlMs`                                                                                                                                                                                                                                                                                    |
| Search & Extraction | `zotero`           | 15     | Search & Concurrency: `maxSearchResults`, `maxNoteScanRecords`, `searchConcurrency`, `graphConcurrency`, `retrieveAttachmentCap`; Passages & Fulltext Extraction: `maxEvidenceChars`, `maxEvidencePassages`, `maxDetailChars`, `maxNoteBodyChars`, `maxNoteChars`, `maxNoteRecords`, `maxAnnotationRecords`, `maxAttachmentRecords`, `fulltextChunkWords`, `maxFulltextChars` |
| Literature panel    | `library`          | 1      | Sidebar Display: `rightSidebarEnabled`                                                                                                                                                                                                                                                                                                                                        |
| Scholarly Search    | `scholarly`        | 6      | API Credentials & Identification: `email`, `s2Key`, `ncbiKey`, `openalexKey`; Search & Full-text Quotas: `maxResults`, `maxContentChars`                                                                                                                                                                                                                                      |
| Advanced            | `zotero`           | 9      | Output limits: `maxResponseBytes`, `maxExportChars`, `maxExportRefs`, `maxBrowseResults`, `maxChangesResults`; Background tasks: `enableRunInBackground`, `promoteOnTimeout`, `foregroundWaitMs`; Diagnostics: `debug`                                                                                                                                                        |

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
| `maxDetailChars`           | `3000`                       | Character budget for abstract previews in `zotero_get`                                                                                                                                                                                     |
| `maxNoteBodyChars`         | `30000`                      | Character budget for note bodies                                                                                                                                                                                                           |
| `maxNoteChars`             | `2000`                       | Character budget for a single note preview in `zotero_get`                                                                                                                                                                                 |
| `maxNoteRecords`           | `50`                         | Cap on notes returned by `zotero_get`                                                                                                                                                                                                      |
| `maxAnnotationRecords`     | `100`                        | Cap on annotations returned by `zotero_get`                                                                                                                                                                                                |
| `maxAttachmentRecords`     | `50`                         | Cap on attachments returned by `zotero_get`/`zotero_children`                                                                                                                                                                              |
| `fulltextChunkWords`       | `200`                        | Words per full-text chunk that enters the ranking                                                                                                                                                                                          |
| `maxFulltextChars`         | `250000`                     | Maximum full-text characters one `zotero_retrieve` call accepts (split evenly across multiple attachments)                                                                                                                                 |
| `retrieveAttachmentCap`    | `16`                         | Cap on attachments that join full-text ranking in one `zotero_retrieve` call                                                                                                                                                               |
| `graphConcurrency`         | `4`                          | Concurrency for attachment reads in `zotero_retrieve`                                                                                                                                                                                      |
| `maxResponseBytes`         | `16777216`                   | Streaming byte cap for a single API response (16 MiB)                                                                                                                                                                                      |
| `maxExportChars`           | `1000000`                    | Hard character cap on export output (1,000,000 characters)                                                                                                                                                                                 |
| `maxExportRefs`            | `50`                         | Ref cap for a single `zotero_export` call; the literature panel's `zotero/export` endpoint shares this cap                                                                                                                                 |
| `maxBrowseResults`         | `50`                         | Cap on items returned by a single `zotero_browse` call; also clamps the literature panel's browse page size (collection tree / tags / saved searches, the response carries the effective `limit`)                                          |
| `maxChangesResults`        | `50`                         | Cap on items listed per resource kind in `zotero_changes` (presentation only)                                                                                                                                                              |
| `scopeListingTtlMs`        | `30000`                      | How long a collection or search scope listing is trusted before it is read again (ms)                                                                                                                                                      |
| `defaultStyle`             | `apa`                        | CSL citation style (must be built into Zotero); used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                        |
| `defaultLocale`            | `en-US`                      | CSL citation locale; used by `citation` and `bibliography`, shared by tool exports and literature panel citation copying                                                                                                                   |
| `writeEnabled`             | `false`                      | Whether to register and enable personal library write tools                                                                                                                                                                                |
| `writePersistKey`          | `true`                       | Whether Always-Allow write keys are stored in the host credentials manager                                                                                                                                                                 |
| `writeNoteMaxChars`        | `65536`                      | Character cap for one research note body                                                                                                                                                                                                   |
| `writeListMaxItems`        | `50`                         | Item cap for list-shaped write arguments: `add`/`remove` on `update_item_tags`/`update_item_collections`, `tags` on `delete_library_tags`, and `collections`/`tags`/`sourceRefs` on `create_note`                                          |
| `writeAuthorizeDeadlineMs` | `120000`                     | Time limit for waiting on the Zotero authorization dialog during a write (ms)                                                                                                                                                              |
| `webEnabled`               | `true`                       | Whether to show the literature trail tab at the top of the conversation; also one of the gates for the right-sidebar literature panel                                                                                                      |
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

The literature panel and scholarly search schemas are validated by the components themselves when they mount: `rightSidebarEnabled` must be a boolean; `maxResults` must be an integer from 1 to 100; `maxContentChars` must be an integer from 1,000 to 50,000; the key fields must be strings.

## Configuration priority

```text
Schema defaults → Composition entry config → the current profile's Cordis patch layer
```

All three namespaces follow the same order. The override layer (`config` on the matching entry in the current profile's `cordis.patch.yml`) outranks schema defaults and entry config; a home patch or command-line overlay outranks it, and a form write that they would override is refused.

## Plugin configuration page

Open the **dsh-zotero** detail page in the plugin manager; its configuration area carries the full 6-tab form (through the harness's official `SettingsForm` and `SettingsFormModel`) and edits the `zotero`, `library`, and `scholarly` namespaces in one place:

- Edits are written to the `config` override on the matching entry in the current profile's `cordis.patch.yml`;
- Saves take effect at once: transport configuration and write-gate changes rebuild the matching components inside the service instance, and pure limit fields are read live by the provider;
- Invalid configuration is refused before the write, and the configuration page keeps the valid draft;
- Fields explicitly set by the override layer show a marker and can be reset in one click;
- Form writes are revision-fenced (a stale draft is refused); a write that a home patch or command-line overlay would override does not land either.

The same form state has two more entry points, and the three relate as follows:

1. Unified settings page tabs: the 6-tab form in the plugin detail page's configuration area;
2. Component row configuration: the "Configure" button on the `dsh-zotero#library` and `dsh-zotero#scholarly` rows under "Included components", each editing its own namespace;
3. Configuration file: edit `config` on the matching entry in the current profile's `cordis.patch.yml` directly.

The first two are two views of one `ConfigForm` state, synced live over both channels; the third is the configuration override layer, which a form write takes as its highest priority. While a component row is not composed, the matching tab of the settings page shows only a disabled pointer to "Included components" and renders no field, and the component row configuration entry is not registered either.

## Hot reload behavior

- When transport configuration or a write gate changes, the HTTP client, local provider, and write tool set are rebuilt on the same `ZoteroService` instance;
- Limit configuration changes are read by the provider on the next call, with no transport rebuild;
- The `webEnabled` toggle shows or hides the literature trail tab and the literature panel immediately after saving;
- The `rightSidebarEnabled` toggle shows or hides the right-sidebar literature panel immediately after saving;
- The `debug` toggle takes effect immediately after saving and controls the diagnostics panel at the bottom of the detail page and diagnostic log retention, with no component reinitialization;
- Every other configuration update applies on the next tool call, with no host restart.

## Environments without a settings service

In a headless environment with no settings service, the plugin runs on the entry configuration passed at composition time.

---

## Scholarly component configuration (`dsh-zotero/scholarly`)

The component ships with the package and is off by default. Its only switch is the `dsh-zotero/scholarly` row under "Included components" in the plugin manager: enabling that row mounts the component, registers its 7 model tools, and permits requests to the explicitly allowlisted external academic indexes. While the component is not mounted, the service, transport, and tools do not exist, so the host cannot issue any external request; the equivalent hand edit is `- id: scholarly` plus `disabled: false` in the current profile's `cordis.patch.yml`. The authorization boundary for external retrieval is in the "four boundaries" section of [Product model](product-model.en.md).

Component fields have three entry points: the "Scholarly Search" tab of the unified settings page, the "Configure" button on the `dsh-zotero#scholarly` row in the plugin list, or `config` on that row in the current profile's `cordis.patch.yml`. The first two are two views of one form state, synced live over both channels; the third is the configuration override layer. A field change applies on the next tool call, with no profile restart:

| Field             | Default | Description                                                                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `email`           | none    | Contact email, attached to Crossref, OpenAlex, and NCBI/Europe PMC request headers (joins the Polite Pool for a better rate-limit quota) |
| `s2Key`           | none    | Semantic Scholar API key (optional; avoids rate limits on shared IP pools)                                                               |
| `ncbiKey`         | none    | NCBI / PubMed API key (optional; raises the per-second request cap from 3 to 10)                                                         |
| `openalexKey`     | none    | OpenAlex API key (optional; raises the per-second request cap to 100)                                                                    |
| `maxResults`      | `20`    | Maximum number of papers one search returns (1-100)                                                                                      |
| `maxContentChars` | `12000` | Character cap for chunked full-text reading (1,000-50,000)                                                                               |

While the component is off, the "Scholarly Search" tab of the settings page shows only a pointer to "Included components" and renders no field, and the component row configuration entry is not registered; once the component is on, the tab becomes an editable form. Full texts are cached under `$DSH_HOME/cache/zotero-scholarly/` as one JSON body per key (not controlled by this table, and with no separate switch).

---

## Literature panel component configuration (`dsh-zotero/library`)

The literature panel is an independent DSH bundle subcomponent. It ships with the package and is enabled in the default profile (`cordis.patch.yml` includes `- id: library` / `name: dsh-zotero/library`). It offers whole-library browsing, search, item inspection, and citation copying, shown as a right-sidebar tab beside the conversation.

Component fields have three entry points:

1. Unified settings page, "Literature panel" tab: switch to "Literature panel" in the 6-tab form of the plugin detail page;
2. Included components row configuration: click the "Configure" button on the `dsh-zotero#library` row under "Included components";
3. Configuration file: declare it under `config` on the matching entry in the current profile's `cordis.patch.yml`.

The first two are two views of one form state, synced live over both channels; the third is the configuration override layer.

| Field                 | Default | Description                                                                                                                                                                      |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rightSidebarEnabled` | `true`  | Whether to show the literature panel tab and quick entry in the right sidebar (`sidebarRightTabs` + `sidebar.right.pane.tab`), so literature can be read beside the conversation |

The literature panel appears only when all three conditions hold:

1. The `dsh-zotero/library` component row is composed: while the row is off, no panel surface is registered and no `zotero/browse|search|item|childPage|export|write` request is issued;
2. The core `webEnabled` is on ("General → Literature trail → Show literature trail");
3. This component's `rightSidebarEnabled` is on.

The panel only browses and searches the local Zotero library; writes started from the panel and writes from tools pass through the same approval seam and require the owning session to be running. External retrieval is not part of the panel; see the "four boundaries" section of [Product model](product-model.en.md).
