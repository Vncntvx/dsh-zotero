<p align="right"><a href="product-model.md"><b>中文</b></a></p>

# Product Model

dsh-zotero runs around the local Zotero library. The model uses tools, the human uses the interface, working together through two entry points and two views, backed by three decoupled components.

## Two Entry Points

The system provides independent entry points for the model and the user:

| Entry point        | User     | Interaction channel                             | Responsibilities                                                                                                     |
| :----------------- | :------- | :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| **Agent tools**    | AI model | Tool calls (Function Calling)                   | Search, read full texts, locate passages, and generate citations in conversation; modify the library under approval. |
| **User interface** | User     | Browser interface (right sidebar & session tab) | Browse the library, filter items, read PDFs, and copy citations; verify papers and passages queried by the agent.    |

### Non-Proxying Principle

The two paths operate independently and never proxy each other:

- **The interface never calls tools directly**: "Ask" and "Add to chat" in the panel only populate item details into the composer. Whether and how to send it is up to the user; the web interface has no channel to trigger model tools directly.
- **Tool calls never disrupt the interface**: When the agent calls tools in the background to search or read papers, it does not alter the selected item, collection tree state, or scroll position in the literature panel.

## Two Surfaces

The local Zotero desktop app is the single source of truth. The interface offers two views: one for finding literature, and one for checking what the agent did:

| Surface              | Location        | Role                                                                                                                                                                   | Data source                                       |
| :------------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| **Literature panel** | Right sidebar   | **Global library view**: for manual browsing and citing. Navigate collection trees, tags, saved searches, and the Trash; inspect details and read PDFs.                | Local API (via `zoteroLibrary` service endpoints) |
| **Literature trail** | Session top tab | **Session audit view**: for verifying the agent's work. Lists queried papers, search parameters, extracted passages, and export records from the current conversation. | Tool-call snapshots from the current session      |

Their responsibilities do not overlap: the literature panel does not track what the agent did, and the literature trail does not offer library browsing or editing.

DSH's built-in "Trail" tab records tool-call execution times and raw parameters; the "Literature trail" focuses purely on literature, showing search conditions, source passages, and export records.

## Three Components

The plugin is split into three components with distinct roles:

| Component name             | Role                                                                | Default state | Partition rationale                                                                                                                   |
| :------------------------- | :------------------------------------------------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| **`dsh-zotero` (core)**    | Local communication, base model tools, literature trail, settings   | Enabled       | Plugin foundation, providing core connections and baseline capabilities.                                                              |
| **`dsh-zotero/library`**   | Literature panel service (`zoteroLibrary`) and sidebar interface    | Enabled       | Decouples the library browsing UI so it can be disabled as a whole, with an independent settings namespace.                           |
| **`dsh-zotero/scholarly`** | External scholarly retrieval, open-access full text, citation check | Disabled      | Agent scholarly retrieval authorization boundary; requests to allowlisted indexes and the open-access PDF arm require this component. |

### Component Roles

- **Core component**: The plugin body. Manages communication with the local Zotero API (`127.0.0.1:23119`), registers 8 read tools and 15 write tools, and maintains the literature trail and configuration options.
- **Literature panel component**: Exposes read and write endpoints (`browse`, `search`, `item`, etc.) to the frontend. It registers no tools and injects no prompts; local-library operations forward to the core service. Explicit user reading of URL PDFs has its own `allowUrlPdfRead` permission and public download boundary. It can be unmounted entirely if the sidebar is not needed.
- **Scholarly retrieval component**: Controls agent authorization for external scholarly retrieval. When unmounted, no scholarly tools, prompt section or scholarly requests exist; when mounted, it registers 7 scholarly retrieval tools: index searches stay confined to the allowlisted academic indexes, and the open-access PDF fulltext arm is the single exception, allowed on any public HTTP(S) host under the two-gate public-address check (see [Architecture](architecture.en.md)).

`src/skills/` registers phased instructions through the Harness's optional `ctx.skills`, with the core component owning three and the scholarly retrieval component owning four. The model selects from a catalog of names and short descriptions, then loads the full Markdown body with the `skill` tool; bodies stay out of the standing system prompt. See the [research SOP skill reference](skills.en.md).

## Data Flow

```mermaid
graph LR
    U[User] --> P[Literature panel]
    A[Agent] --> T[Model tools]
    P --> LS[zoteroLibrary service]
    T --> S[ctx.zotero core service]
    LS --> S
    S --> Z[Zotero local API]
    Z --> L[Local Zotero library]
    A -.->|tool-call snapshots| TR[Literature trail]
    U --> TR
    A --> X[Scholarly retrieval component] --> E[External scholarly indexes]
```

Both primary paths reach the local library through `ctx.zotero`. Agent external scholarly retrieval requires the scholarly component. Explicit user reading of URL attachments is authorized independently by the literature panel and does not mount scholarly.

## Four Boundaries

1. **Write safety**: Write tools are disabled by default. Once enabled, they may modify only the personal library (`zotero://user/0/`); every write (from the agent or the panel) requires approval and plan card confirmation, with no automatic retries on failure.
2. **Network isolation**: Local requests connect strictly to loopback addresses (`127.0.0.1`) without following redirects; agent external scholarly retrieval requires the scholarly component. Index searches are allowlisted, while its open-access PDF arm accepts public HTTP(S) hosts. Explicit user reading of library URL PDFs requires separate `allowUrlPdfRead` permission; both PDF paths validate public addresses and pin DNS answers at every hop.
3. **Trail scope**: The literature trail records only read tool calls and exports from this session; writes are recorded on approval cards and do not enter the trail; external papers found via scholarly search do not enter the trail until saved to the library.
4. **Scope limits**: The Trash is accessible only via the literature panel and is not exposed to model tool search scopes; panel searches cover only the local library, leaving external discovery to the agent via the scholarly component.

## Typical Workflows

- **Research and verify in chat**: Ask questions in chat → the agent queries the local library and extracts passages with page numbers → switch to the **literature trail** at the top to check search terms and original sources.
- **Browse and cite in the sidebar**: Open the **literature panel** in the right sidebar to browse collections or filter items, and read PDFs; copy BibTeX or CSL citations from the action row, or click "Ask" to send the item into the composer.
- **Find and save external literature**: Have the agent search external indexes and read open-access full text via the scholarly component; save selected papers to the personal library upon confirmation, after which they appear in both the panel and the trail.

## Library panel navigation rules

Collections and saved searches load continuous prefixes per level. Load more retains existing rows. Selecting a different scope clears keywords and added filters while preserving search mode and sort; selecting the same scope or reopening preserves the query. Expanders only expand; names only select. Locate follows actual parents to load and reveal the current collection.

## Literature panel navigation rules

Collection and saved-search pages accumulate within each prefix. Moving between collections and All items in one library preserves query and extra filters by default; panel settings can clear them. Switching libraries, saved searches or Trash always clears them while preserving mode and sorting. Re-selecting the current scope preserves the query. Expand controls only expand, names select, and Locate follows the real parent chain.

Explicit user reading of URL PDFs in the library requires the panel's independent permission. It resolves an existing attachment and downloads only after a click, without enabling scholarly search. Profile settings and browsing positions are separate: positions belong to the browser, Zotero instance and conversation.
