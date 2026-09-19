<p align="right"><a href="getting-started.md"><b>中文</b></a></p>

# Getting Started

dsh-zotero is a DSH plugin that lets agents search, read, and cite your local Zotero library.

## Prerequisites

- Zotero ≥ 7 desktop installed
- Local API enabled: Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"
- Node.js ≥ 22.19 or ≥ 24
- DSH 0.1.6-alpha.2 (peer dependencies listed in package.json; only the latest pre-release line is supported until upstream stabilizes, with no backward compatibility)

Version mapping:

| Plugin version | Minimum dsh version |
| -------------- | ------------------- |
| 0.5.1          | 0.1.1-rc.2          |
| 0.5.2          | 0.1.2-alpha.1       |
| 0.6.0          | 0.1.2-alpha.5       |
| 0.7.0          | 0.1.3-alpha.1       |
| 0.7.1          | 0.1.3-alpha.1       |
| 0.8.0          | 0.1.6-alpha.2       |
| 0.8.1          | 0.1.6-alpha.2       |
| 0.8.2          | 0.1.6-alpha.2       |
| 0.8.3          | 0.1.6-alpha.2       |
| 0.8.4          | 0.1.6-alpha.2       |

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
Zotero version: 10.0.2-beta.9+c77df79af
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

**The npm and tarball channels need no allowance at all**: they ship prebuilt artifacts (`lib/` is published with the package), so they work immediately. If a GitHub install already failed, switching to one of those two channels bypasses the build allowance below.

**The GitHub channel pulls source**, so it runs `prepare` (`npm run build`) on your machine: typecheck the Node half, then bundle the browser half. pnpm ≥ 10 blocks dependency build scripts by default, so the first `add` fails and prints the package key to allow; copy that key into **this profile's** `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-zotero: true
```

(Use the exact key pnpm printed. In pnpm 10 this setting is named `onlyBuiltDependencies` and takes an array. The file is `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml`.)

> `nothing installable … need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts` means exactly this: pick one of the two — allow the build as above, or use the npm/tarball channel.

Pin to a specific commit for reproducibility:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

Installing from a tarball needs no extra configuration — just point to the local `.tgz` file.
