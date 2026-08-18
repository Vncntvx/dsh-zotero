<p align="right"><a href="getting-started.md"><b>中文</b></a></p>

# Getting Started

dsh-zotero is a DSH plugin that lets agents search, read, and cite your local Zotero library.

## Prerequisites

- Zotero ≥ 7 desktop installed
- Local API enabled: Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"
- Node.js ≥ 22.19 or ≥ 24
- DSH runtime (peer dependencies listed in package.json)

## Install the plugin

From npm (recommended):

```sh
dsh plugin --profile <profile-name> add dsh-zotero
```

From GitHub:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero
```

From a local tarball:

```sh
npm pack
dsh plugin --profile <profile-name> add ./dsh-zotero-*.tgz
```

After installing, the plugin mounts as `zotero` and takes effect on the next dsh startup. If the current session was created before the plugin loaded, start a new session after installation.

## Verify the connection

Run in a session:

```
/zotero status
```

Expected output:

```
Zotero local API: connected
API version: 12
Schema version: 11
Server ID: abc123def456
```

Common issues:

- **Zotero not running**: make sure the Zotero desktop app is open
- **Local API not enabled**: go back to Zotero Settings and confirm the "Allow other applications" option is checked

## First example

Tell the agent in a session:

> Find papers about FlashAttention

The agent calls `zotero_search` to search your library and returns matching entries. You can then use `zotero_get` to view abstracts, notes, and attachment details, and `zotero_retrieve` to extract specific evidence from papers based on a query.

## Notes for GitHub or tarball installs

Installing from GitHub pulls the source and runs `prepare` (`npm run build`). pnpm ≥ 10 requires `allowBuilds` in pnpm-workspace.yaml:

```yaml
onlyBuiltDependencies:
  - dsh-zotero
```

Pin to a specific commit for reproducibility:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

Installing from a tarball needs no extra configuration — just point to the local `.tgz` file.
