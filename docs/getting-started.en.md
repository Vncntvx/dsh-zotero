<p align="right"><a href="getting-started.md"><b>中文</b></a></p>

# Getting Started

dsh-zotero is a Zotero plugin for DeepSeek Harness that enables agents to search, read, and cite your local Zotero library.

## Prerequisites

- Zotero ≥ 7 desktop installed (reads require Zotero ≥ 7; writes require Zotero 10)
- Local API enabled: **Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"**
- Node.js ≥ 22.19 or ≥ 24
- Host dsh >= 0.2.1-alpha.2

Version mapping:

| Plugin version | Minimum dsh version         |
| -------------- | --------------------------- |
| 0.5.1          | 0.1.1-rc.2                  |
| 0.5.2          | 0.1.2-alpha.1               |
| 0.6.0          | 0.1.2-alpha.5               |
| 0.7.0          | 0.1.3-alpha.1               |
| 0.7.1          | 0.1.3-alpha.1               |
| 0.8.0          | 0.1.5-alpha.1               |
| 0.8.1          | 0.1.5-rc.1                  |
| 0.8.2          | 0.1.5-rc.2                  |
| 0.8.3          | 0.1.5-rc.2                  |
| 0.8.4          | 0.1.5-rc.2                  |
| 0.9.0          | 0.1.5-rc.1 or 0.1.6-alpha.2 |
| 0.9.1          | 0.1.7-alpha.2               |
| 0.10.0         | 0.1.7-rc.1                  |
| 0.10.1         | 0.1.7-rc.2                  |
| 0.11.0         | 0.1.7-rc.2                  |
| 0.12.0         | 0.2.0-rc.2                  |
| 0.12.1         | 0.2.1-alpha.1               |
| 0.13.0-alpha.1 | 0.2.1-alpha.1               |
| 0.13.0-alpha.2 | 0.2.1-alpha.2               |

## Installing the Plugin

From npm (recommended):

```sh
dsh plugin --profile <profile-name> add dsh-zotero
```

From GitHub prebuilt branch:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#release
```

From a local tarball:

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <profile-name> add ./dsh-zotero-*.tgz
```

When installing directly from the GitHub `main` source branch, pnpm blocks build scripts by default. Add the package to `allowBuilds` in `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-zotero: true
```

To pin to a specific commit for reproducibility:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

The plugin mounts under identifier `zotero` and takes effect on the next dsh startup. If your current session was created before the plugin loaded, start a new session.

When enabling the plugin in Harness's plugin manager, an activation check runs automatically to verify Zotero local API connectivity.

## Verifying Connection

Run the status command in the chat composer:

```text
/zotero
```

Or the equivalent `/zotero status`.

Expected response:

```text
Zotero local API: connected
Local API: 127.0.0.1:23119
Zotero version: 10.0.6-beta.4+4d4c2c141
API version: 3
Schema version: 44
Server ID: Cq1f76x70ESV
```

The version lines come from the response headers of the Zotero build that answered, so they follow your Zotero install. `API version` is the local API version the plugin pins on every request (3); a build that does not speak it answers with 501 instead.

If connection fails, verify:

1. Zotero desktop application is running.
2. "Allow other applications on this computer to communicate with Zotero" is checked in Zotero Preferences → Advanced.

## First Example

Ask the agent in a conversation:

> Find papers about FlashAttention

The agent calls `zotero_search` to query your library and returns matching entries. You can then use `zotero_get` to inspect metadata, abstracts, and notes, or `zotero_retrieve` to extract relevant passages from indexed text and annotations.
