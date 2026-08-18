<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# dsh-zotero Configuration Reference

All configuration fields are defined in `src/config.ts`, with defaults provided by a Schemastery schema. `resolveConfig` performs runtime validation when the plugin loads. Invalid configuration prevents the plugin from loading.

## Field overview

| Field                  | Default                      | Description                                                    |
| ---------------------- | ---------------------------- | -------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Zotero Local API address, must be loopback HTTP                |
| `provider`             | `local`                      | Selected provider id                                           |
| `timeoutMs`            | `5000`                       | Single request timeout (ms)                                    |
| `maxSearchResults`     | `20`                         | `zotero_search` max return count                               |
| `maxNoteScanRecords`   | `200`                        | Max note items scanned during note content search              |
| `maxEvidenceChars`     | `6000`                       | Evidence passage total character budget                        |
| `maxEvidencePassages`  | `4`                          | Evidence passage count limit                                   |
| `maxDetailChars`       | `3000`                       | `zotero_get` abstract preview character budget                 |
| `maxNoteBodyChars`     | `30000`                      | Note body character budget                                     |
| `maxNoteChars`         | `2000`                       | `zotero_get` single note preview character budget              |
| `maxNoteRecords`       | `50`                         | `zotero_get` max note count                                    |
| `maxAnnotationRecords` | `100`                        | `zotero_get` max annotation count                              |
| `fulltextChunkWords`   | `200`                        | Word count for full-text chunks entering ranking               |
| `maxFulltextChars`     | `250000`                     | Max full-text characters accepted by `zotero_retrieve` ranking |
| `maxResponseBytes`     | `16777216`                   | Single API response stream byte limit (16 MiB)                 |
| `maxExportChars`       | `1000000`                    | Export output hard limit (1M characters)                       |
| `maxExportRefs`        | `50`                         | Single `zotero_export` ref count limit                         |
| `defaultStyle`         | `apa`                        | CSL citation style (must be built into Zotero)                 |
| `defaultLocale`        | `en-US`                      | CSL citation locale                                            |
| `webEnabled`           | `true`                       | Whether to enable Zotero session tab in dsh web                |

## Validation rules

`resolveConfig` performs these checks at load time, throwing on invalid config:

- `baseUrl` must use `http:` protocol (Zotero Local API does not support HTTPS)
- `baseUrl` hostname must be a loopback address: `127.0.0.1`, `localhost`, `::1`, `[::1]`
- `timeoutMs` must be a positive finite number
- All numeric limit fields must be positive integers
- `provider`, `defaultStyle`, `defaultLocale` must be non-empty strings

## Config priority

```
Schema defaults → composition entry config → settings.yaml user layer
```

The user layer (settings document) always overrides the base layer. Patch entry config is the base layer; the user layer can override freely.

## Settings card

The plugin registers a settings card under Settings → Plugins → Plugin configuration, bound to the `zotero` settings namespace.

- Writes land in the `zotero:` section of `$DSH_HOME/settings.yaml`
- Save takes effect immediately: transport and provider rebuild with the new values
- Invalid values are rejected before write; the card retains the last valid draft
- Fields overridden by the settings document show an "Overridden" badge, resettable with one click
- External edits to `settings.yaml` also hot-reload

## Hot-reload behavior

- Settings changes automatically rebuild the HTTP client and local provider
- The next tool call or `/zotero status` uses the new values, no restart needed
- `webEnabled` toggle takes effect immediately: the tab shows/hides right away

## Compositions without settings service

Headless compositions (without the settings service) do not register the settings card; the plugin runs with the values from the patch entry config.
