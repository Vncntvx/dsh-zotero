<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# dsh-zotero Configuration Reference

All configuration fields are defined in `src/config.ts`, with defaults provided by a Schemastery schema. `resolveConfig` performs runtime validation when the plugin loads. Invalid configuration prevents the plugin from loading.

## Field overview

| Field                  | Default                      | Description                                                                                    |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Zotero Local API address, must be loopback HTTP rooted at `/api`                               |
| `provider`             | `local`                      | Selected provider id                                                                           |
| `timeoutMs`            | `5000`                       | Single request timeout (ms)                                                                    |
| `maxSearchResults`     | `20`                         | `zotero_search` max return count                                                               |
| `maxNoteScanRecords`   | `200`                        | Max note items scanned during note content search                                              |
| `maxEvidenceChars`     | `6000`                       | Evidence passage total character budget                                                        |
| `maxEvidencePassages`  | `4`                          | Evidence passage count limit                                                                   |
| `maxDetailChars`       | `3000`                       | `zotero_get` abstract preview character budget                                                 |
| `maxNoteBodyChars`     | `30000`                      | Note body character budget                                                                     |
| `maxNoteChars`         | `2000`                       | `zotero_get` single note preview character budget                                              |
| `maxNoteRecords`       | `50`                         | `zotero_get` max note count                                                                    |
| `maxAnnotationRecords` | `100`                        | `zotero_get` max annotation count                                                              |
| `fulltextChunkWords`   | `200`                        | Word count for full-text chunks entering ranking                                               |
| `maxFulltextChars`     | `250000`                     | Max full-text characters one `zotero_retrieve` call accepts (shared across its attachments)    |
| `maxResponseBytes`     | `16777216`                   | Single API response stream byte limit (16 MiB)                                                 |
| `maxExportChars`       | `1000000`                    | Export output hard limit (1M characters)                                                       |
| `maxExportRefs`        | `50`                         | Single `zotero_export` ref count limit                                                         |
| `maxBrowseResults`     | `50`                         | Single `zotero_browse` max return count                                                        |
| `maxChangesResults`    | `50`                         | Per-resource listing cap of one `zotero_changes` call (display only; the read is always whole) |
| `defaultStyle`         | `apa`                        | CSL citation style (must be built into Zotero)                                                 |
| `defaultLocale`        | `en-US`                      | CSL citation locale                                                                            |
| `writeEnabled`         | `false`                      | Whether to register and allow the three personal-library write tools                           |
| `writePersistKey`      | `true`                       | Whether Always-Allow write keys persist in the host credentials service                        |
| `webEnabled`           | `true`                       | Whether to enable Zotero session tab in dsh web                                                |

## Validation rules

`resolveConfig` performs these checks at load time, throwing on invalid config:

- `baseUrl` must use `http:` protocol (Zotero Local API does not support HTTPS)
- `baseUrl` hostname must be a loopback address: `127.0.0.1`, `localhost`, `::1`, `[::1]`
- `baseUrl` path must be the Local API root (`/api`)
- `timeoutMs` must be a positive finite number
- All numeric limit fields must be positive integers
- `provider`, `defaultStyle`, `defaultLocale` must be non-empty strings

## Config priority

```
Schema defaults → composition entry config → settings.yaml user layer
```

The user layer (settings document) always overrides the base layer. Patch entry config is the base layer; the user layer can override freely.

## Settings page

The plugin registers a **Zotero** page in the Settings panel's left navigation (beside General, Models, and Plugins), bound to the `zotero` settings namespace.

- Writes land in the `zotero:` section of `$DSH_HOME/settings.yaml`
- Save takes effect immediately: structural transport or write-gate fields rebuild transport/provider/write tools on the same service instance; provider id remains a live selection, and limit-only fields are read live by the provider
- Invalid values are rejected before write; the page retains the last valid draft
- Fields overridden by the settings document show an "Overridden" badge, resettable with one click
- External edits to `settings.yaml` also hot-reload

## Hot-reload behavior

- Transport-field or write-gate changes rebuild the HTTP client, local provider, and write-tool set on the same `ZoteroService` instance; a provider-id change only affects the next selection
- Limit-only changes use the provider's live getter on the next call without rebuilding transport
- The next tool call or `/zotero status` uses the new values, no restart needed
- `webEnabled` toggle takes effect immediately: the tab shows/hides right away

## Compositions without settings service

Headless compositions (without the settings service) serve no content for the settings page; the plugin runs with the values from the patch entry config. The page still appears in the Settings panel and states that this deployment serves no Zotero settings.
