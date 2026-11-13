<p align="right"><a href="product-model.md"><b>中文</b></a></p>

# Product Model

dsh-zotero runs around the local Zotero library. The model uses tools, the human uses the interface, working together through two entry points and two views, backed by four decoupled components.

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

## Four Components

The plugin is split into four components with distinct roles:

| Component name              | Role                                                                      | Default state | Partition rationale                                                                                                                                        |
| :-------------------------- | :------------------------------------------------------------------------ | :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`dsh-zotero` (core)**     | Local communication, base model tools, literature trail, settings         | Enabled       | Plugin foundation, providing core connections and baseline capabilities.                                                                                   |
| **`dsh-zotero/library`**    | Literature panel service (`zoteroLibrary`) and sidebar interface          | Enabled       | Decouples the library browsing UI so it can be disabled as a whole, with an independent settings namespace.                                                |
| **`dsh-zotero/scholarly`**  | External scholarly retrieval, open-access full text, citation check       | Disabled      | Agent scholarly retrieval authorization boundary; requests to allowlisted indexes and the open-access PDF arm require this component.                      |
| **`dsh-zotero/enrichment`** | User-submitted MinerU parsing, artifact reuse, and local semantic ranking | Disabled      | Enabling accepts MinerU document egress and provides parsing and model management; every upload still requires explicit submission of a specific document. |

### Component Roles

- **Core component**: The plugin body. Manages communication with the local Zotero API (`127.0.0.1:23119`), registers 8 read tools and 15 write tools, and maintains the literature trail and configuration options.
- **Literature panel component**: Exposes read and write endpoints (`browse`, `search`, `item`, etc.) to the frontend. It registers no tools and injects no prompts; local-library operations forward to the core service. Explicit user reading of URL PDFs has its own `allowUrlPdfRead` permission and public download boundary. It can be unmounted entirely if the sidebar is not needed.
- **Scholarly retrieval component**: Provides external academic retrieval for the agent. When disabled, no scholarly tools are registered; when enabled, it registers seven tools querying allowlisted academic platforms (HTTPS) and open-access PDF hosts (with public address validation and fake-IP support).
- **Document parsing component**: provides explicit parsing, existing-artifact lookup, and local semantic model management. Enabling the component accepts MinerU document egress; the client shows the egress disclosure while the component is served and this browser has not acknowledged it, and remembers the acknowledgement per client. It registers no model tools and injects no prompt section. Ordinary `zotero_retrieve` and `scholarly_read` calls use the core's read-only `FulltextEnhancer.lookup` to find valid Markdown for the same source. A hit takes priority; a miss continues through the existing Zotero fulltext index or authorized PDF download and local extraction. Local semantic ranking is independent of MinerU; explicit parsing needs no semantic model.

`src/skills/` registers phased instructions through the Harness's optional `ctx.skills`, with the core component owning four and the scholarly retrieval component owning four. The model selects from a catalog of names and short descriptions, then loads the full Markdown body with the `skill` tool; bodies stay out of the standing system prompt. See the [research SOP skill reference](skills.en.md).

### Explicit Parsing Contract

The descriptions below state the current enrichment implementation.

Enabling the component accepts MinerU document egress; mounting starts no upload. The user submits one specific Zotero PDF attachment (child or top-level) or one public PDF URL, and the host checks remote-action and session access. Before submission, the interface shows the target, MinerU, the selected mode, what uploading means, and the limits. It does not select every PDF under a parent item automatically or accept host paths, session files, or caller-supplied raw bytes. Neither the panel's URL PDF reading permission nor scholarly authorization grants MinerU parsing.

Ordinary reads, PDF opening, settings saves, and service startup do not create or resume a MinerU task or upload a document. Existing valid artifacts always remain readable. When an artifact is absent or the source has changed, reads use the original index or locally extracted text. A failed parse does not change mode or present local text as a successful parse.

Explicit parsing uses session-owned `ctx.jobs` work with progress, cancellation, and bounded receipts; the interface submits through typed endpoints without calling model tools. Closing the interface releases observation only; cancellation, session close, and component unmount revoke the corresponding waiter. Shared parsing aborts when its last waiter leaves and finishes cleanup. Accepted foreground reads drain within their original deadlines, with model resources retained through switches or unmounts. No aliases or migrations for legacy components, config, cache formats, or interfaces are added.

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
    S -.->|read-only lookup| PA[Document parsing component]
    U -.->|explicit attachment or public URL submission| PA
    PA -.->|component authorization and explicit submission| M[MinerU external parsing service]
```

Both primary paths reach the local library through `ctx.zotero`. Agent external scholarly retrieval requires the scholarly component. Explicit user reading of URL attachments is authorized independently by the literature panel and does not mount scholarly. The enrichment paths in the diagram are the current implementation: ordinary reads only query existing artifacts, and only a specific target explicitly submitted by the user enters a parsing job and generates external requests.

## Four Boundaries

1. **Write safety**: Write tools are disabled by default. Once enabled, they modify only the personal library (`zotero://user/0/`); all write operations require approval and plan card confirmation, returning an error on failure without automatic retries.
2. **Network isolation**: Local communication connects to loopback addresses (`127.0.0.1`). Agent scholarly retrieval accesses allowlisted index platforms and public open-access PDF hosts; the literature panel supports downloading existing URL attachments via `allowUrlPdfRead`; both PDF download paths perform public address validation and DNS pinning (with fake-IP placeholder support). MinerU document uploads occur only when enrichment is enabled and the user explicitly submits a document, with untrusted dynamic upload URLs verified identically.
3. **Trail scope**: The literature trail displays read tool calls and exports from the current session; writes are recorded on approval cards; external literature enters the trail after being saved to the library.
4. **Scope limits**: The Trash is accessible only in the literature panel; model search tools exclude the Trash. The literature panel is dedicated to the local library, while external literature discovery is handled by the agent.

## Typical Workflows

- **Research and verify in chat**: Ask questions in chat → the agent queries the local library and extracts passages with page numbers → switch to the **literature trail** at the top to check search terms and original sources.
- **Browse and cite in the sidebar**: Open the **literature panel** in the right sidebar to browse collections or filter items, and read PDFs; copy BibTeX or CSL citations from the action row, or click "Ask" to send the item into the composer.
- **Find and save external literature**: Have the agent search external indexes and read open-access full text via the scholarly component; save selected papers to the personal library upon confirmation, after which they appear in both the panel and the trail.

## Literature panel navigation rules

Collection and saved-search pages accumulate within each prefix. Moving between collections and All items in one library preserves query and extra filters by default; panel settings can clear them. Switching libraries, saved searches or Trash always clears them while preserving mode and sorting. Re-selecting the current scope preserves the query. Expand controls only expand, names select, and Locate follows the real parent chain.

Explicit user reading of URL PDFs in the library requires the panel's independent permission. It resolves an existing attachment and downloads only after a click, without enabling scholarly search. Profile settings and browsing positions are separate: positions belong to the browser, Zotero instance and conversation.
