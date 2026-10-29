<p align="right"><a href="getting-started.md"><b>中文</b></a></p>

# Getting Started

dsh-zotero connects your local Zotero library to DeepSeek Harness: the agent searches and studies literature in conversation, you browse the full library in the literature panel, and the literature trail lets you verify the references and source passages used in the session.

## Prerequisites

- Zotero ≥ 7 desktop installed (reads require Zotero ≥ 7; writes require Zotero 10).
- Local API enabled: **Settings → Advanced → check "Allow other applications on this computer to communicate with Zotero"**.
- Node.js ≥ 22.19 or ≥ 24.
- Host dsh ≥ 0.2.1-rc.3; for the mapping of earlier versions, see GitHub Releases.

## Installing the Plugin

### Desktop app (Plugin Manager)

In the DeepSeek Harness desktop app under **Plugins** (or **Settings → Plugins**), click **Install Plugin** and enter the package identifier:

- Latest version (recommended): `dsh-zotero`
- Specific version: `dsh-zotero@<version>` (e.g. `dsh-zotero@0.14.1`)
- GitHub prebuilt branch: `github:Vncntvx/dsh-zotero#release`
- GitHub specific tag or commit: `github:Vncntvx/dsh-zotero#v0.14.1` or `github:Vncntvx/dsh-zotero#<commit-hash>`

### Command line

From npm (recommended):

```sh
dsh plugin --profile <profile-name> add dsh-zotero
```

Install a specific version:

```sh
dsh plugin --profile <profile-name> add dsh-zotero@<version>
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

When installing from the GitHub `main` source branch, the `prepare` build script must run locally. Allow that package's build scripts in `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-zotero: true
```

To pin a specific version or commit, append its hash to the link:

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

After installation the plugin mounts under the identifier `zotero`. It takes effect the next time dsh starts; if the current session was created before the plugin loaded, start a new session.

When you enable the plugin in the Harness plugin management list, the system probes the local connection automatically to check the Zotero local API status.

## Verifying Connection

In the chat composer, run the status command:

```text
/zotero
```

Or the equivalent `/zotero status`.

A healthy response looks like:

```text
Zotero local API: connected
Local API: 127.0.0.1:23119
Zotero version: 10.0.6-beta.4+4d4c2c141
API version: 3
Schema version: 44
Server ID: Cq1f76x70ESV
```

These version lines come from the response headers of the Zotero build that answered, so they follow your Zotero version. `API version` is the local API version the plugin pins on every request (3); a Zotero build that does not support that version answers with 501.

If the connection fails, check:

1. The Zotero desktop app is running;
2. "Allow other applications on this computer to communicate with Zotero" is checked in Zotero's Advanced preferences panel.

## First task: search and check

Ask in a conversation:

> Find papers about FlashAttention

The agent calls `zotero_search` to query the library and returns matching items. If it needs the content, it goes on to call `zotero_get` for metadata and notes, or `zotero_retrieve` to extract passages for the question.

Then switch to the literature trail tab at the top of the session and check item by item:

- whether the search criteria on the first screen (query, scope, mode, filters) and the hit counts match what you asked;
- whether the passages the agent cited, in the inspector's "Passages", come from annotations, notes, the abstract, or the full-text index, and whether annotations carry page numbers;
- whether the "Exports" section holds the citation text you requested in the conversation.

The literature trail is a read-only view: it records tool calls completed in the current session and never issues new requests.

## Opening the literature panel

The literature panel lives in the right sidebar. Make sure all three are on:

1. The `dsh-zotero/library` row under "Included components" in the plugin list is enabled (on by default);
2. `webEnabled` under "General → Literature trail" on the settings page is on (on by default);
3. "Show in right sidebar" (`rightSidebarEnabled`) on the "Literature panel" tab of the settings page is on (on by default).

Once the panel is open, start with the search box at the top; select an item to see its details in the inspector, and use the action row to copy a citation or read the PDF.

Next: the [product model](product-model.en.md) explores interaction patterns, UI surfaces, and system boundaries, and the [features overview](features.en.md) walks through each capability.
