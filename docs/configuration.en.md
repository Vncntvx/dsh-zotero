<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# Configuration Reference

All configuration fields are defined in `src/config.ts`, with default values provided by a Schemastery schema. `resolveConfig` performs runtime validation during plugin loading. Invalid configuration will prevent the plugin from loading.

## Field List

| Field                      | Default                      | Description                                                                                                               |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API address, must be loopback HTTP with an `/api` prefix (`localhost` is resolved to `127.0.0.1` at runtime) |
| `provider`                 | `local`                      | Selected provider identifier                                                                                              |
| `timeoutMs`                | `5000`                       | Single HTTP request timeout in milliseconds                                                                               |
| `maxInFlightRequests`      | `8`                          | Maximum concurrent in-flight requests to the Local API                                                                    |
| `maxSearchResults`         | `20`                         | Maximum items returned by `zotero_search`                                                                                 |
| `maxNoteScanRecords`       | `200`                        | Maximum note records scanned for note content searches                                                                    |
| `searchConcurrency`        | `4`                          | Concurrency limit for parent attribution queries in `zotero_search`                                                       |
| `maxEvidenceChars`         | `6000`                       | Total character budget for evidence passages                                                                              |
| `maxEvidencePassages`      | `4`                          | Maximum number of evidence passages returned                                                                              |
| `maxDetailChars`           | `3000`                       | Character budget for abstract previews in `zotero_get`                                                                    |
| `maxNoteBodyChars`         | `30000`                      | Character budget for note bodies                                                                                          |
| `maxNoteChars`             | `2000`                       | Character budget for single note previews in `zotero_get`                                                                 |
| `maxNoteRecords`           | `50`                         | Maximum note items returned by `zotero_get`                                                                               |
| `maxAnnotationRecords`     | `100`                        | Maximum annotation items returned by `zotero_get`                                                                         |
| `fulltextChunkWords`       | `200`                        | Word count for full-text chunks in ranking                                                                                |
| `maxFulltextChars`         | `250000`                     | Maximum full-text characters accepted in a single `zotero_retrieve` call (shared across attachments)                      |
| `retrieveAttachmentCap`    | `16`                         | Maximum attachments ranked for full text in a single `zotero_retrieve` call                                               |
| `graphConcurrency`         | `4`                          | Concurrency limit for attachment reads in `zotero_retrieve`                                                               |
| `maxResponseBytes`         | `16777216`                   | Streaming byte limit for a single API response (16 MiB)                                                                   |
| `maxExportChars`           | `1000000`                    | Hard character limit for export output (1M characters)                                                                    |
| `maxExportRefs`            | `50`                         | Maximum references in a single `zotero_export` call                                                                       |
| `maxBrowseResults`         | `50`                         | Maximum items returned by a single `zotero_browse` call                                                                   |
| `maxChangesResults`        | `50`                         | Display limit per resource kind in `zotero_changes`                                                                       |
| `scopeListingTtlMs`        | `30000`                      | Cache TTL in milliseconds for collection and search scopes                                                                |
| `defaultStyle`             | `apa`                        | CSL citation style (must be built into Zotero)                                                                            |
| `defaultLocale`            | `en-US`                      | CSL citation locale                                                                                                       |
| `writeEnabled`             | `false`                      | Whether to register and enable personal library write tools                                                               |
| `writePersistKey`          | `true`                       | Whether to persist Always-Allow write keys in the host credentials store                                                  |
| `writeNoteMaxChars`        | `65536`                      | Maximum characters for a research note body                                                                               |
| `writeListMaxItems`        | `50`                         | Maximum list argument items in a single write call                                                                        |
| `writeAuthorizeDeadlineMs` | `120000`                     | Timeout in milliseconds when waiting for Zotero authorization dialog                                                      |
| `webEnabled`               | `true`                       | Whether to enable the Zotero session tab in DSH Web                                                                       |
| `enableRunInBackground`    | `true`                       | Whether to allow the `run_in_background` tool parameter                                                                   |
| `promoteOnTimeout`         | `true`                       | Whether to promote long foreground export or sync operations to background Jobs on timeout                                |
| `foregroundWaitMs`         | `4000`                       | Foreground wait limit in milliseconds before automatic promotion to background Job                                        |

Note: `foregroundWaitMs` controls how long foreground operations wait before promoting to a background Job; `timeoutMs` controls individual Zotero HTTP request timeouts. They operate independently.

## Validation Rules

`resolveConfig` enforces the following rules at load time:

- `baseUrl` must use the `http:` protocol (Zotero Local API does not support HTTPS) and must not contain user credentials, query strings, or URL fragments;
- `baseUrl` hostname must be a loopback address (`127.0.0.1`, `localhost`, `::1`, `[::1]`); `localhost` is resolved to `127.0.0.1` at runtime;
- `baseUrl` path must be `/api` or start with `/api/`;
- `timeoutMs` must be a positive finite number;
- All numeric limit fields and `foregroundWaitMs` must be positive integers;
- `provider`, `defaultStyle`, and `defaultLocale` must be non-empty strings.

## Configuration Priority

```text
Schema defaults → Composition entry config → settings.yaml user layer
```

The user layer (`settings.yaml`) takes top priority, overriding schema defaults and composition entry configurations.

## Settings Page

The plugin registers a **Zotero** page in the left navigation of the Settings panel, bound to the `zotero` namespace:

- Edits persist to the `zotero:` section in `$DSH_HOME/settings.yaml`.
- Changes take effect immediately: transport and write gate changes rebuild relevant components within the service instance; limit fields are read live by the provider.
- Invalid entries are rejected before saving, preserving the last valid draft on the page.
- Overridden fields display a badge with an inline reset option.
- External edits to `settings.yaml` hot-reload automatically.

## Hot-Reload Behavior

- Changes to transport fields or write gates rebuild the HTTP client, local provider, and write tools on the existing `ZoteroService` instance.
- Limit modifications are read live on subsequent calls without rebuilding transport components.
- The `webEnabled` toggle displays or hides the tab immediately upon save.
- Nearly all configuration updates apply to the next tool invocation without restarting the host.

## Environments Without Settings Service

In headless environments lacking a settings service, the plugin runs using values from the entry composition configuration.
