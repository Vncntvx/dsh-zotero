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

- **Symptom**: returns `ZOTERO_API_VERSION` error, requires version 3
- **Cause**: Zotero version too old, local API does not support version 3
- **Fix**: upgrade Zotero to a version that supports API version 3

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

**7. pnpm allowBuilds error on GitHub install**

- **Symptom**: first add fails, pnpm refuses to run prepare
- **Cause**: pnpm ≥ 10 blocks prepare for git dependencies by default
- **Fix**: add allowBuilds config to the profile's `pnpm-workspace.yaml`

---

**8. Zotero tab not showing**

- **Symptom**: no Zotero Sources tab at the top of `dsh web` sessions
- **Cause**: `webEnabled` set to false, or plugin not loaded
- **Fix**: check the webEnabled toggle in the settings card; confirm plugin is installed and loaded

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
