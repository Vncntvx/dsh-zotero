<p align="right"><a href="troubleshooting.md"><b>中文</b></a></p>

# Troubleshooting

This document lists common issues, possible causes, and the matching fixes when using dsh-zotero.

## 1. Cannot connect to Zotero

- Symptom: tool calls return the `ZOTERO_NOT_RUNNING` error.
- Cause: the Zotero desktop app is not running, or the local port is not listening.
- Fix: launch Zotero, then open Settings → Advanced and check "Allow other applications on this computer to communicate with Zotero".

## 2. Local API request refused (403)

- Symptom: tool calls return the `ZOTERO_API_DISABLED` error.
- Cause: Zotero is running, but local API communication is off.
- Fix: open Zotero Settings → Advanced and check "Allow other applications on this computer to communicate with Zotero".

## 3. Incompatible API version

- Symptom: tool calls return the `ZOTERO_API_VERSION` error.
- Cause: the Zotero local API version differs from the version the plugin supports.
- Fix: use the version number in the error message. If Zotero is too old, upgrade Zotero; if Zotero's local API moved ahead, update the dsh-zotero plugin.

## 4. Scholarly tools do not appear

- Symptom: the model cannot see the seven scholarly tools such as `scholarly_search`, or the "Scholarly Search" tab of the settings page shows only a pointer and no field.
- Cause: the `dsh-zotero/scholarly` component is not mounted. The component ships with the package and is off by default, and that row is its only switch: while the component is not mounted, the service, transport, and tools do not exist, and the host issues no external request.
- Fix: turn on the `dsh-zotero/scholarly` row under "Included components" in the plugin manager; the tools and the settings page take effect without a restart. The authorization boundary for external retrieval is in [Product model](product-model.en.md).

## 5. Zotero tools missing from the current session after installation

- Symptom: the agent cannot recognize or call the Zotero tools.
- Cause: the current session was created before the plugin loaded.
- Fix: start a new conversation to pick up the newly installed tools.

## 6. Search finds items but retrieve returns no full-text passages

- Symptom: `zotero_retrieve` returns an empty passage list, or `sourcesSkipped` includes `"fulltext"`.
- Cause: the target PDF has no full-text index in Zotero yet.
- Fix: right-click the attachment in the Zotero client and choose "Rebuild Index"; or use `zotero_attachment` to get the local file path and read it directly.

## 7. PDF reading and locating an item in Zotero

- Native reading: clicking "Read PDF" in the literature panel, the literature trail, or a tool card opens a local attachment in the reader bar of the DeepSeek Harness right sidebar, with no jump to an external application; desktop and Web behave the same. The literature panel's reader bar anchors to the session that owns the panel, so with several sessions open it opens in the current one.
- URL attachments: when the attachment itself is an external URL rather than a local PDF file, "Read PDF" opens that address in a new browser tab.
- Open refused: when the host refuses to open the reader bar or a new tab, the action row shows an inline hint in place. The action never fails silently and is never retried automatically.
- Quick locating: to view the item in the local Zotero client, click "Copy title" and paste it into Zotero quick search (`Cmd+F` or `Ctrl+F`); or click "Copy Zotero link" and paste the canonical deep link (personal and group libraries supported) into an external note or the address bar.

## 8. Installation says nothing installable

- Symptom: `dsh plugin --profile <profile> add` fails with `nothing installable: the plugin(s) need a build step`.
- Cause: installing from a GitHub source branch builds locally, and pnpm blocks dependency builds by default.
- Fix:
  - Recommended: install through the npm package name or a GitHub `#release` prebuilt branch.
  - To build from source: add `dsh-zotero` to the `allowBuilds` list in the current profile's `pnpm-workspace.yaml`, then retry.

## 9. Literature trail does not appear

- Symptom: no "Literature trail" tab at the top of the conversation.
- Cause: the core `webEnabled` setting ("General → Literature trail → Show literature trail") is off; or the core `dsh-zotero` component row is not enabled and the plugin failed to load (a browser-half assembly failure ends in an entry rejection, and the harness marks the plugin as failed to load).
- Fix:
  1. In the plugin manager, confirm the `dsh-zotero` row is enabled and the detail page shows no load failure;
  2. On the **dsh-zotero** detail page, open "General → Literature trail" in the configuration area and confirm "Show literature trail" is on and saved; the toggle takes effect at once after saving, with no page refresh;
  3. The literature trail and the literature panel do not share one gate chain: the trail follows only the core component and `webEnabled`, while the panel needs three gates at once (`dsh-zotero/library` component row + `webEnabled` + `rightSidebarEnabled`), see item 19.

## 10. A single export exceeds the 50-item limit

- Symptom: a tool call returns the `ZOTERO_INVALID_ARGUMENT` error and says the ref count is over the limit.
- Cause: the five formats other than `citation` (`bibliography`, BibTeX, BibLaTeX, RIS, and CSL JSON) export at most 50 items per call, which comes from Zotero's `itemKey` request cap.
- Fix: call `zotero_export` in batches of at most 50 items; or switch to `citation`, which batches automatically in groups of 50, though `maxExportRefs` must be raised above 50 first.

## 11. Server ID or ref mismatch

- Symptom: a tool call returns the `ZOTERO_SERVER_MISMATCH` error.
- Cause: the ref comes from another Zotero instance (for example after a database path change or a sync to a new machine).
- Fix: run the search again to get fresh refs for the current instance, and do not reuse old refs across instances.

## 12. Configuration file changes do not take effect

- Symptom: plugin behavior does not change after the configuration is edited.
- Cause: the wrong file or wrong place. User-level configuration lives under `config` on the matching entry (`zotero` / `library` / `scholarly`) in the current profile's `cordis.patch.yml`; the YAML key nesting may also be wrong, or the entry may be overridden by a home patch or command-line overlay.
- Fix: open the **dsh-zotero** configuration area in the plugin manager and save once (the write lands in the current profile's `cordis.patch.yml`), then run `/zotero` to verify the state; make sure the file you edited belongs to the profile used for this launch.

## 13. Tool cards do not expand in the conversation

- Symptom: the model calls tools, but the message stream shows only a summary bar (for example "Called tools · 2.1s").
- Cause: "Work details" in the DSH general settings defaults to standard mode, which folds process cards after execution.
- Fix: click the process summary bar above the message to expand the cards in place; to keep them expanded by default, open Settings → General → Work details and choose **Verbose** (`verbose`).

## 14. A write is refused with `ZOTERO_INVALID_ARGUMENT`

- Symptom: a write tool returns `ZOTERO_INVALID_ARGUMENT` right away, with messages such as `Unknown itemType "…"`, `A new item needs at least a title or a URL`, `add and remove must carry at least one entry between them`, or `tags must carry at least one item`.
- Cause: these checks run in the tool layer before any network request, so no plan card appears and Zotero receives no write.
- Fix: correct the arguments as the message says: use an `itemType` from the closed set (`webpage` / `journalArticle` / `book` / `conferencePaper` / `report` / `thesis` / `document` / `preprint`); keep list arguments non-empty; write only updatable fields in `set`.
- A second class of `ZOTERO_INVALID_ARGUMENT` can be decided only after a read, so it arrives after approval and those reads: `A collection named "…" already exists at that level`, `Field "…" is not valid for item type "…"`. Neither issues a write request, but the plan card has already appeared.

## 15. Delete plan card counts show unknown

- Symptom: in the `zotero_delete_collection` or `zotero_delete_library_tags` plan card, item, subcollection, or tag counts show `unknown`.
- Cause: the preview reads before a delete are best-effort, and a failed read does not block the plan; the delete itself still carries the library version of its preceding read.
- Fix: run `/zotero` first to confirm the connection, then decline the plan card and run again to get exact counts.

## 16. A write returns ZOTERO_WRITE_CONFLICT (412)

- Symptom: the write submission is refused with `ZOTERO_WRITE_CONFLICT`.
- Cause: the object changed between the read and the commit, so the version precondition failed. This is the expected safety behavior.
- Fix: run the tool once more; the re-run reads the version again and redoes the merge.

## 17. The result is committed-unverified (write submitted but unverified)

- Symptom: a write tool returns `committed-unverified`, and the card shows a warning state with no success badge.
- Cause: Zotero accepted the write, but the response cannot prove the final state (the commit is unknown or the saved state is unverified).
- Fix: do not retry; check by key/ref in Zotero whether the object was created or changed.

## 18. How to collect diagnostics

When the error message alone is not enough to track an issue down (a feature fails silently, a card or tab renders wrongly, a result comes back odd), export a diagnostic log as follows:

1. Open the **dsh-zotero** detail page in the plugin manager, turn on "Diagnostic mode" in the "Advanced → Diagnostics" group of the configuration area, and save.
2. Once it is on, a "Diagnostics" card appears at the bottom of the detail page; reproduce the issue once, then click "Copy diagnostics" in that card and attach the content to your report.
3. The exported bundle contains the plugin version, the running Zotero endpoint and version, the debug toggle state, and log entries in reverse chronological order (frontend component render failures are also summarized there).

Note: diagnostic records stay in the current process memory and are cleared when the host restarts. If you need to keep them, copy the bundle before restarting the host.

## 19. Literature panel does not appear

- Symptom: the right sidebar has no "Literature panel" tab or quick entry; the "Literature panel" tab of the settings page shows only a pointer to "Included components".
- Cause: the literature panel needs three gates at once: the `dsh-zotero/library` component row is composed; the core `webEnabled` ("General → Literature trail → Show literature trail") is on; the component's own `rightSidebarEnabled` ("Literature panel → Sidebar Display → Show in right sidebar") is on. If any one is off, no panel surface is registered and no `zotero/browse|search|item|childPage|export|write` request is issued.
- Fix:
  1. Under "Included components" in the plugin manager, confirm the `dsh-zotero/library` row is enabled and reload the plugin;
  2. Confirm the core `webEnabled` is on (see item 9);
  3. Open the "Literature panel" tab of the settings page or the "Configure" button on the `dsh-zotero#library` row, confirm "Show in right sidebar" is on and saved; the toggle takes effect at once after saving;
  4. If all three gates hold and the panel still does not appear, copy diagnostics as in item 18 and check whether the plugin failed to load.

## 20. Literature panel is offline

- Symptom: the status lamp at the top of the panel shows "Offline", everything below the toolbar is replaced by the offline note, and browse, search, and detail requests pause.
- Cause: local Zotero is not running, the local API is not enabled, `baseUrl` points at the wrong local port, or the current Zotero instance does not match the source the panel refers to (Server ID mismatch).
- Fix: launch Zotero and check "Allow other applications on this computer to communicate with Zotero" in Settings → Advanced; confirm `baseUrl` on the "Connection" tab of the configuration area matches the current instance; click "Refresh" in the panel to probe again, and the list and detail reload once the connection is back. The status lamp and the diagnosis text in the offline note tell "not running" apart from "local API disabled".

## 21. Citation copy fails

- Symptom: "Copy citation", "Copy BibTeX", or one entry under "More formats" in the literature panel item inspector action row fails, and the action row shows "Copy failed: <reason>" inline; or the control shows "Formatting…" during the request and no clipboard content arrives.
- Cause: the `zotero/export` endpoint request failed (local API unreachable, timeout, export content over a limit, unsupported ref or format), or the browser refused the clipboard write (insecure context, no clipboard permission). The panel does not retry automatically.
- Fix: confirm the Zotero connection is fine (see items 1 and 2), then click that format once more; a single-item copy is not affected by `maxExportRefs`, so if the error points at oversized export content, check `maxExportChars` and `maxExportRefs` under "Advanced → Output limits"; when the clipboard is unavailable, copy the text from "Copy Zotero link" or "Read PDF" instead. If the failure persists, copy diagnostics as in item 18.

## 22. Literature trail is empty

- Symptom: the literature trail tab is there, but the "Literature" view says "No Zotero papers in this session yet."
- Cause: the session has not called any read tool yet (search, browse, detail, child objects, passages, attachment location, export); or the session was created before the plugin loaded, so the agent has no Zotero tools; or the session only wrote and did external scholarly retrieval. The literature trail records read tools and exports only, never writes, and never external papers.
- Fix: first ask the agent in the conversation to search or read the library (for example `zotero_search`, `zotero_get`); confirm the session was created after the plugin loaded and retry; confirm the core `webEnabled` is on. Scholarly results appear in the trail only after they are saved into the Zotero library. Manual browsing in the literature panel does not write to the trail, which reflects agent tool calls only.
