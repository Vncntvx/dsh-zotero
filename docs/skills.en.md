<p align="right"><a href="skills.md"><b>中文</b></a></p>

# Research SOP skill reference

Skills are phased instructions. The model selects a skill from a short catalog and loads the full Markdown SOP with the Harness `skill` tool. Full bodies stay out of the standing system prompt; names and short descriptions remain in the catalog, which still uses some tokens.

Catalog names, descriptions and trigger keywords are English-only. The model matches Chinese-language requests cross-lingually. `tests/host/skill-contracts.spec.ts` asserts that no CJK characters remain.

## Selecting a skill

| Skill                               | Component | Input → output                                                                              | Boundary                                                                              |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `zotero-research-landscape`         | Scholarly | Research question → search log, topic clusters, anchors and tentative gaps                  | Proposal/scoping discovery, not seed-paper citation tracing                           |
| `zotero-citation-lineage`           | Scholarly | Seed DOI/arXiv/PMID → directed citation edges and uncovered branches                        | Citations do not establish support or causation; similarity edges stay separate       |
| `zotero-paper-digest`               | Core      | Single paper → metadata, located core evidence and BibTeX brief                             | Single-paper rapid reading; no cross-paper synthesis or topic discovery               |
| `zotero-evidence-synthesis`         | Core      | Fixed 2–12 papers → located experiment/method comparison matrix                             | Compares research evidence, not individual draft claims                               |
| `zotero-manuscript-reference-audit` | Core      | Supplied draft/bibliography → claim/citation/record/passage audit                           | Does not edit manuscript files or discover new topics                                 |
| `zotero-library-governance`         | Core      | Explicit existing-library scope → field/tag/collection differences and reviewed corrections | No outside intake, automatic duplicate merging or deletion                            |
| `zotero-publication-integrity`      | Scholarly | Suspect publications → identity, field and source-reported retraction checks                | Investigates specific concerns rather than repeating routine whole-draft verification |
| `zotero-literature-intake`          | Scholarly | User-selected outside works → verification, deduplication, approval and receipts            | Saves metadata for selected literature to the local library                           |

Scholarly means the `dsh-zotero/scholarly` component. Its four skills are absent while it is disabled. Core skills may use conditional external verification/fulltext recipes only when their tools are available; otherwise they return local results and evidence gaps without bypassing authorization through shell or other network routes.

## Phases, batching, and exit criteria

Every SOP defines four ordered phases, stage budgets, structured recipes, failure handling, exit criteria, and an output contract. Phase state lives in the model's compact task ledger. Reuse identity and evidence already obtained. Handoffs carry input IDs, queries, refs, locators, exclusions, and unresolved issues.

| Workflow         | Order                                                            | Default budgets and exit criteria                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landscape        | Frame → search → anchors → themes/gaps                           | Up to 3 searches, 8 results per search and 5 detailed anchors per theme. Use one theme for a quick map. For a broader review, set theme and anchor budgets before discovery. Close a theme at adequate coverage, after two searches with no new work, or when the budget is spent.    |
| Lineage          | Seed → first hop → selected frontier → directed relations        | Default to two hops, 5 graph calls, 3 expanded first-hop nodes and 10 results per call. An explicit broader request sets a finite depth and call budget. Stop when the path is found or the frontier is empty.                                                                        |
| Digest           | Metadata/attachments → focused evidence → citation → brief       | Bounded to single paper; at most 4 passages; abstract-only fallback if unindexed; stop on brief output                                                                                                                                                                                |
| Synthesis        | Corpus/axes → locate → BM25 → compare                            | At most two BM25 calls per paper, including one reformulation; up to 6 local passages subject to smaller live limits, 5 external; final fallback is one targeted section/chunk up to 4000 characters                                                                                  |
| Manuscript audit | Inventory → identity → support → differences                     | Batch independent sections by claim ID and share evidence across claims about the same ref. Use at most two BM25 calls per unique claim/ref, four passages each. Rematch once for changed fingerprints. Give every input an outcome.                                                  |
| Governance       | Bound → inspect → proposal → approve/reconcile                   | Default 5 pages and 100 top-level items; user may explicitly expand scope once before execution; incomplete directories block writes; no standing scan                                                                                                                                |
| Integrity        | Suspects → registry → cross-index → report                       | Verification batches of 40; one cross-index check each for at most 10 suspects; index failure never means the paper does not exist                                                                                                                                                    |
| Intake           | Selection → verify/deduplicate → field mapping → approval/settle | Verify in batches of 40, match in batches of 50 and rejoin by input ID. Run independent verification batches concurrently where supported. Use at most 50 write operations per reviewed batch, subject to configuration. Reconcile any partial or uncertain commit before proceeding. |

Prefer batch metadata for known local refs: up to 50 unique refs, standard fields. Match external fingerprints in batches, each with a unique `inputId` and DOI or title; avoid repeating a full-library DOI scan per paper. Correct a parameter name once against the schema rather than guessing repeatedly.

## Evidence and safety boundaries

- Locate sections from attachment metadata and annotations, retrieve relevant BM25 passages, and quote source text with verified locators.
- Native Zotero annotations provide `pageLabel`; when page numbers are absent in local full text or Scholarly passages, locate by section, character offset, or chunk index. User comments and paper text are labeled distinctly.
- `UNVERIFIED` indicates an unreachable registry, while `NOT FOUND` indicates no record matched; similar titles require identifier checks to confirm identity. Retraction reports must state the check date, queried indexes, and missing sources.
- Root agents execute explicitly requested writes only through the `ctx.zotero` capability gate, `ctx.approval.request` and plan-review card. Subagents return proposals only. `committed-unverified` and unverified batch entries are reconciled, not retried.
- Child identity follows durable session `origin`/`delegationDepth`, including resumed derived sessions that are runtime roots. All 15 core writes and the Scholarly save entry are hidden; an execution guard also refuses calls supplied by name. Root approval remains intact.

## Registration and maintenance

`src/skills/` is Host-only. Each SOP declares TypeScript data and Markdown instructions; `definition.ts` renders shared contracts and JSON recipes, while `register.ts` uses optional `ctx.inject(['skills'])` registration. Core owns 4 SOPs and Scholarly owns 4. Fibers remove registrations when components or the registry unload; a late or replaced registry rebinds automatically.

The Harness base composition supplies the `dsh-skill` registry and `dsh-tool-skill` consumer. Custom compositions need both. Versions are generated with `npm run harness:pin -- 0.2.3-alpha.2`, and npm updates the lockfile.

Test ownership: `tests/host/skills.spec.ts` covers composition and lifecycle; `tests/scholarly/skills.spec.ts` covers the external authorization catalog; `tests/host/skill-contracts.spec.ts` checks every recipe against recipe arguments, the parameter tables parsed from both language tool references, and real schema properties, with recursive nested-key checks and tool-name scans across model-facing fields; `tests/host/subagent-view.spec.ts` covers the scoped tool view and restriction lifecycle, `tests/host/subagent-guard.spec.ts` covers execution-time denial and refresh failure containment; `tests/unit/tooling/client-graph-authority.spec.ts` refuses browser imports. Tests access neither a real library nor external indexes.

Before release run focused specs, `npm run typecheck`, `npm test` and `npm run release:check`. Builds compile TS bodies directly, without copying Markdown assets. Release gates check client authority, coverage, build and packaging. Parameter contracts remain in the [tool reference](tools.en.md).
