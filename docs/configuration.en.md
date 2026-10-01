<p align="right"><a href="configuration.md"><b>中文</b></a></p>

# dsh-zotero Configuration Reference

All configuration fields are defined in `src/config.ts`, with defaults provided by a Schemastery schema. `resolveConfig` performs runtime validation when the plugin loads. Invalid configuration prevents the plugin from loading.

## Field overview

| Field                      | Default                      | Description                                                                                                                                         |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API address, must be loopback HTTP with path `/api` or an `/api/` prefix (`localhost` is pinned to `127.0.0.1` at runtime)             |
| `provider`                 | `local`                      | Selected provider id                                                                                                                                |
| `timeoutMs`                | `5000`                       | Single request timeout (ms)                                                                                                                         |
| `maxInFlightRequests`      | `8`                          | Max concurrent in-flight requests the plugin keeps against the Local API                                                                            |
| `maxSearchResults`         | `20`                         | `zotero_search` max return count                                                                                                                    |
| `maxNoteScanRecords`       | `200`                        | Max note items scanned during note content search                                                                                                   |
| `searchConcurrency`        | `4`                          | Parallel parent-attribution queries a search's membership lookups keep in flight                                                                    |
| `maxEvidenceChars`         | `6000`                       | Evidence passage total character budget                                                                                                             |
| `maxEvidencePassages`      | `4`                          | Evidence passage count limit                                                                                                                        |
| `maxDetailChars`           | `3000`                       | `zotero_get` abstract preview character budget                                                                                                      |
| `maxNoteBodyChars`         | `30000`                      | Note body character budget                                                                                                                          |
| `maxNoteChars`             | `2000`                       | `zotero_get` single note preview character budget                                                                                                   |
| `maxNoteRecords`           | `50`                         | `zotero_get` max note count                                                                                                                         |
| `maxAnnotationRecords`     | `100`                        | `zotero_get` max annotation count                                                                                                                   |
| `fulltextChunkWords`       | `200`                        | Word count for full-text chunks entering ranking                                                                                                    |
| `maxFulltextChars`         | `250000`                     | Max full-text characters one `zotero_retrieve` call accepts (shared across its attachments)                                                         |
| `retrieveAttachmentCap`    | `16`                         | Max attachments one `zotero_retrieve` call ranks full text from                                                                                     |
| `graphConcurrency`         | `4`                          | Parallel attachment reads one `zotero_retrieve` keeps in flight                                                                                     |
| `maxResponseBytes`         | `16777216`                   | Single API response stream byte limit (16 MiB)                                                                                                      |
| `maxExportChars`           | `1000000`                    | Export output hard limit (1M characters)                                                                                                            |
| `maxExportRefs`            | `50`                         | Single `zotero_export` ref count limit                                                                                                              |
| `exportConcurrency`        | `4`                          | Parallel single-item reads one `zotero_export` keeps in flight                                                                                      |
| `maxBrowseResults`         | `50`                         | Single `zotero_browse` max return count                                                                                                             |
| `maxChangesResults`        | `50`                         | Per-resource listing cap of one `zotero_changes` call (display only; the read is always whole)                                                      |
| `scopeListingTtlMs`        | `30000`                      | How long a collections/searches scope listing stays cached (ms)                                                                                     |
| `defaultStyle`             | `apa`                        | CSL citation style (must be built into Zotero)                                                                                                      |
| `defaultLocale`            | `en-US`                      | CSL citation locale                                                                                                                                 |
| `writeEnabled`             | `false`                      | Whether to register and allow the three personal-library write tools                                                                                |
| `writePersistKey`          | `true`                       | Whether Always-Allow write keys persist in the host credentials service                                                                             |
| `writeNoteMaxChars`        | `65536`                      | Character cap for one research note body                                                                                                            |
| `writeListMaxItems`        | `50`                         | Max items in one write call's list arguments                                                                                                        |
| `writeAuthorizeDeadlineMs` | `120000`                     | Deadline for the Zotero authorization dialog during a write (ms)                                                                                    |
| `webEnabled`               | `true`                       | Whether to enable Zotero session tab in dsh web                                                                                                     |
| `enableRunInBackground`    | `true`                       | Whether the explicit `run_in_background` tool parameter may start a background Job (timeout promotion is governed separately by `promoteOnTimeout`) |
| `promoteOnTimeout`         | `true`                       | Whether to automatically promote foreground export/changes to a background Job on timeout                                                           |
| `foregroundWaitMs`         | `4000`                       | Foreground wait ceiling (ms) before automatic promotion to background Job                                                                           |

Note: `foregroundWaitMs` (default 4000) bounds the **foreground job wait**; `timeoutMs` (default 5000) bounds **one Zotero HTTP request**. They are independent. Whether promotion should fire before the provider deadline remains an open verification item (see `waitOrPromote` in `src/job-runner.ts` and `tests/unit/job-runner.spec.ts`); defaults are unchanged.

## Validation rules

`resolveConfig` performs these checks at load time, throwing on invalid config:

- `baseUrl` must use `http:` protocol (Zotero Local API does not support HTTPS); it must not carry credentials (`user:pass@`), a query string (`?…`), or a fragment (`#…`)
- `baseUrl` hostname must be a loopback address: `127.0.0.1`, `localhost`, `::1`, `[::1]`; `localhost` is pinned to `127.0.0.1` at runtime (the config and the settings page keep the original spelling; diagnostics show the dialed address)
- `baseUrl` path must be `/api` or start with `/api/` (`/api`, `/api/`, and `/api/v3` all pass; `/`, `/v2`, and `/apis` are refused)
- `timeoutMs` must be a positive finite number
- All numeric limit fields and `foregroundWaitMs` must be positive integers
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
