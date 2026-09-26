<p align="right"><a href="troubleshooting.md"><b>中文</b></a></p>

# dsh-zotero Troubleshooting

---

**1. Cannot connect to Zotero**

- **Symptom**: tool call returns `ZOTERO_NOT_RUNNING` error
- **Cause**: Zotero not running, or local API not enabled
- **Fix**: start Zotero, go to Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"

---

**2. Local API rejected (403)**

- **Symptom**: returns `ZOTERO_API_DISABLED` error
- **Cause**: local API disabled in Zotero settings
- **Fix**: enable local API in Zotero Settings → Advanced

---

**3. API version incompatible**

- **Symptom**: returns `ZOTERO_API_VERSION`, saying local API version 3 is not implemented
- **Cause**: Zotero and the plugin share no local API version. Either Zotero is older than version 3, or it is newer than this plugin line (say, offering only version 4). The message names the version that answered, which tells the two apart
- **Fix**: upgrade Zotero when it is older than version 3; update dsh-zotero when it is newer
- Not the same as `ZOTERO_NOT_IMPLEMENTED`: there Zotero states with 501 that the endpoint or output format itself is unimplemented. That is not a version problem, and no upgrade is advised

---

**4. Zotero tools not visible after install**

- **Symptom**: agent does not know about Zotero tools
- **Cause**: session created before plugin loaded
- **Fix**: start a new session

---

**5. Search has results but retrieve returns no full-text evidence**

- **Symptom**: `zotero_retrieve` returns empty evidence or sourcesSkipped includes `"fulltext"`
- **Cause**: Zotero has not yet built a full-text index for that PDF
- **Fix**: right-click the attachment in Zotero → "Rebuild Index"; or use `zotero_attachment` to get the file path

---

**6. zotero:// deep link does not open**

- **Symptom**: clicking "Open in Zotero" does nothing
- **Cause**: browser or system does not support `zotero://` protocol navigation
- **Fix**: copy the ref or path and search manually in Zotero; deep link behavior varies by browser and system

---

**7. Install reports `nothing installable` (build blocked, or no prebuilt artifacts)**

- **Symptom**: `dsh plugin add` fails with `nothing installable: the plugin(s) need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts`
- **Cause**: the GitHub channel pulls source, so the package carries no `lib/` artifacts and `prepare` has to build them on your machine; pnpm ≥ 10 blocks dependency build scripts by default, leaving neither artifacts nor an authorized build
- **Fix**: either
  - allow the build: copy the package key pnpm printed into **that profile's** `pnpm-workspace.yaml`, then re-run:
    ```yaml
    allowBuilds:
      dsh-zotero: true
    ```
  - switch to a prebuilt channel (recommended): install from the npm package name or a local tarball. Both carry the built `lib/` and need no allowance

---

**8. Zotero tab not showing**

- **Symptom**: no Zotero Sources tab at the top of `dsh web` sessions
- **Cause**: `webEnabled` set to false, or plugin not loaded
- **Fix**: check the webEnabled toggle on the Zotero page in the Settings panel's left navigation; confirm plugin is installed and loaded

---

**9. Export exceeds 50-item limit**

- **Symptom**: returns `ZOTERO_INVALID_ARGUMENT` error, refs exceeds 50
- **Cause**: BibTeX/BibLaTeX/RIS/CSL JSON formats accept up to 50 items per call
- **Fix**: split into batches of 50 or fewer; citation format auto-batches

---

**10. Server ID/ref mismatch**

- **Symptom**: returns `ZOTERO_SERVER_MISMATCH` error
- **Cause**: ref from a different Zotero instance (e.g., after switching Zotero databases)
- **Fix**: re-search to get fresh refs; do not reuse old refs

---

**11. Config change not taking effect**

- **Symptom**: tool behavior unchanged after editing `settings.yaml`
- **Cause**: wrong config file path, or YAML syntax error
- **Fix**: confirm you edited the `zotero:` section in `$DSH_HOME/settings.yaml`; run `/zotero status` to verify

---

**12. Tool cards not directly visible in chat (only final reply or timer summary bar shows)**

- **Symptom**: The model invoked Zotero tools, but the chat timeline only shows the final answer or a collapsed turn summary bar with a timer (e.g. "Called tools · 2.1s") rather than expanded tool cards
- **Cause**: DSH's "Work details" setting defaults to "Standard" mode, which automatically folds completed turn processes behind the turn header to keep the chat tidy
- **Fix**:
  - Click the turn summary bar with the timer icon above the message to expand the dedicated tool cards in place
  - To keep tool cards expanded by default across history and active turns, set **Settings → General → Work details** to **"Verbose"** (`verbose`)
