<p align="right"><a href="troubleshooting.md"><b>中文</b></a></p>

# Troubleshooting

This document lists common issues, causes, and diagnostic steps when using dsh-zotero.

## 1. Cannot Connect to Zotero

- **Symptom**: Tool calls return `ZOTERO_NOT_RUNNING`.
- **Cause**: Zotero desktop is not running or the local port is not listening.
- **Fix**: Launch Zotero, go to **Settings → Advanced**, and verify that "Allow other applications on this computer to communicate with Zotero" is checked.

## 2. Local API Rejected (403)

- **Symptom**: Tool calls return `ZOTERO_API_DISABLED`.
- **Cause**: Zotero is running, but local API communications are disabled.
- **Fix**: Open Zotero **Settings → Advanced** and enable "Allow other applications on this computer to communicate with Zotero".

## 3. Incompatible API Version

- **Symptom**: Tool calls return `ZOTERO_API_VERSION`.
- **Cause**: The Zotero local API version differs from what the plugin supports.
- **Fix**: Check the version in the error message. If Zotero is outdated, upgrade Zotero; if Zotero introduced a new API version, update dsh-zotero.

## 4. Tools Not Visible After Installation

- **Symptom**: The agent cannot recognize or call Zotero tools.
- **Cause**: The current session was created before the plugin was loaded.
- **Fix**: Start a new chat session to use the newly installed tools.

## 5. Search Yields Results but Retrieve Returns No Full-Text Evidence

- **Symptom**: `zotero_retrieve` returns an empty evidence list, or `sourcesSkipped` includes `"fulltext"`.
- **Cause**: The PDF has not been indexed in Zotero yet.
- **Fix**: Right-click the attachment in Zotero and select "Rebuild Index", or use `zotero_attachment` to obtain the local file path.

## 6. zotero:// Deep Links Do Not Open

- **Symptom**: Clicking "Open in Zotero" or related protocol links has no effect.
- **Cause**: The operating system or browser lacks a valid protocol handler for `zotero://`.
- **Fix**: Copy the item ref or file path and search directly within Zotero.

## 7. Installation Error: nothing installable

- **Symptom**: `dsh plugin add` fails with `nothing installable: the plugin(s) need a build step`.
- **Cause**: Installing from the GitHub source branch runs build scripts locally, which pnpm blocks by default.
- **Fix**:
  - Recommended: Install using the npm package name or the GitHub `#release` prebuilt branch;
  - If building from source: add `dsh-zotero` to `allowBuilds` in the profile's `pnpm-workspace.yaml`.

## 8. Zotero Tab Does Not Appear

- **Symptom**: No Zotero tab appears at the top of the web interface.
- **Cause**: `webEnabled` is set to `false`, or the plugin failed to load.
- **Fix**: Check the `webEnabled` toggle under **Settings → Zotero** and confirm the plugin is enabled.

## 9. Export Exceeds 50-Item Limit

- **Symptom**: Tool calls return `ZOTERO_INVALID_ARGUMENT`, indicating too many references.
- **Cause**: BibTeX, BibLaTeX, RIS, and CSL JSON formats accept at most 50 items per call.
- **Fix**: Split the export into batches of 50 or fewer; `citation` format batches automatically.

## 10. Server ID or Ref Mismatch

- **Symptom**: Tool calls return `ZOTERO_SERVER_MISMATCH`.
- **Cause**: The ref belongs to a different Zotero instance (e.g. database path changed or migrated).
- **Fix**: Perform a new search to obtain fresh refs for the current instance.

## 11. Configuration Changes Do Not Take Effect

- **Symptom**: Tool behavior remains unchanged after editing `settings.yaml`.
- **Cause**: Incorrect file path or invalid YAML indentation.
- **Fix**: Confirm edits are in the `zotero:` block of `$DSH_HOME/settings.yaml`, and run `/zotero` to verify.

## 12. Tool Cards Do Not Automatically Expand

- **Symptom**: The model invokes tools, but the message timeline only displays a collapsed summary bar (e.g. "Called tools · 2.1s").
- **Cause**: DSH's "Work details" setting defaults to standard mode, automatically folding completed tool cards.
- **Fix**: Click the timer summary bar above the message to expand the tool cards. To keep tool cards expanded by default, navigate to **Settings → General → Work details** and select **Verbose** (`verbose`).
