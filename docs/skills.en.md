<p align="right"><a href="skills.md"><b>中文</b></a></p>

# Research SOP skill reference

This page serves researchers and developers using or maintaining research workflows. Skills are phased instructions. The model selects a skill from a short catalog and loads the full Markdown SOP with the Harness `skill` tool. Full bodies stay out of the standing system prompt; names and short descriptions remain in the catalog, which still uses some tokens.

Catalog names, descriptions and trigger keywords are English-only. The model matches Chinese-language requests cross-lingually. `tests/host/skill-contracts.spec.ts` asserts that no CJK characters remain.

## Selecting a skill

| Skill                               | Component | Input → output                                                                              | Boundary                                                                              |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `zotero-research-landscape`         | Scholarly | Research question → search log, topic clusters, anchors and tentative gaps                  | Proposal/scoping discovery, not seed-paper citation tracing                           |
| `zotero-citation-lineage`           | Scholarly | Seed DOI/arXiv/PMID → directed citation edges and uncovered branches                        | Citations do not establish support or causation; similarity edges stay separate       |
| `zotero-evidence-synthesis`         | Core      | Fixed 2–12 papers → located experiment/method comparison matrix                             | Compares research evidence, not individual draft claims                               |
| `zotero-manuscript-reference-audit` | Core      | Supplied draft/bibliography → claim/citation/record/passage audit                           | Does not edit manuscript files or discover new topics                                 |
| `zotero-library-governance`         | Core      | Explicit existing-library scope → field/tag/collection differences and reviewed corrections | No outside intake, automatic duplicate merging or deletion                            |
| `zotero-publication-integrity`      | Scholarly | Suspect publications → identity, field and source-reported retraction checks                | Investigates specific concerns rather than repeating routine whole-draft verification |
| `zotero-literature-intake`          | Scholarly | User-selected outside works → verification, deduplication, approval and receipts            | No autonomous discovery; metadata saving does not download a PDF                      |

Scholarly means the `dsh-zotero/scholarly` component. Its four skills are absent while it is disabled. Core skills may use conditional external verification/fulltext recipes only when their tools are available; otherwise they return local results and evidence gaps without bypassing authorization through shell or other network routes.

## Phases, batching and termination

Every SOP has four ordered phases, structured recipes, failure/termination rules and an output contract. Phase state lives in the model's compact task ledger. Reuse identity and evidence already obtained; handoffs carry input IDs, queries, refs, locators, exclusions and unresolved issues.

| Workflow         | Order                                                            | Default budget and termination                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landscape        | Frame → search → anchors → themes/gaps                           | Two query formulations plus one filter adjustment, at most 3 searches; 8 results each and 5 detailed anchors; stop after two searches add no included work or themes are covered                     |
| Lineage          | Seed → first hop → selected frontier → directed relations        | Two hops, 5 graph calls, expand at most 3 first-hop nodes, 10 results per call; deduplicate visited nodes and stop on an empty frontier                                                              |
| Synthesis        | Corpus/axes → locate → BM25 → compare                            | At most two BM25 calls per paper, including one reformulation; up to 6 local passages subject to smaller live limits, 5 external; final fallback is one targeted section/chunk up to 4000 characters |
| Manuscript audit | Inventory → identity → support → differences                     | At most two BM25 calls per unique claim/ref question, 4 passages each; rematch once only when the input fingerprint changes; stop with an outcome for every input                                    |
| Governance       | Bound → inspect → proposal → approve/reconcile                   | Default 5 pages and 100 top-level items; user may explicitly expand scope once before execution; incomplete directories block writes; no standing scan                                               |
| Integrity        | Suspects → registry → cross-index → report                       | Verification batches of 40; one cross-index check each for at most 10 suspects; index failure never means the paper does not exist                                                                   |
| Intake           | Selection → verify/deduplicate → field mapping → approval/settle | Verify 40 and match 50 at a time; prefer native core batch create for multiple works, at most 50 total operations and the configured limit; partial/uncertain commits stop subsequent batches        |

Prefer batch metadata for known local refs: up to 50 unique refs, standard fields. Match external fingerprints in batches, each with a unique `inputId` and DOI or title; avoid repeating a full-library DOI scan per paper. Correct a parameter name once against the schema rather than guessing repeatedly.

## Evidence and safety boundaries

- Locate outlines/sections, then BM25 passages for a concrete question, then quote short original text with an observed locator. Local indexed fulltext has no outline API; use attachment metadata/annotations and do not pretend a directory exists or sequentially read entire documents.
- Only native Zotero annotations may provide `pageLabel`; local fulltext and Scholarly passages do not guarantee page numbers. State missing pages and retain actual section/character/chunk locators. User annotation comments are not paper quotations.
- Registry `UNVERIFIED` differs from `NOT FOUND`; similar titles do not establish identity; no reported retraction is not proof of no retraction. Include the checked-at date, answering indexes and missing sources.
- Root agents execute explicitly requested writes only through the `ctx.zotero` capability gate, `ctx.approval.request` and plan-review card. Skills have no approval exemption. Children return proposals; `committed-unverified` and unverified batch entries are reconciled, never retried.
- Child identity follows durable session `origin`/`delegationDepth`, including resumed derived sessions that are runtime roots. All 15 core writes and the Scholarly save entry are hidden; an execution guard also refuses calls supplied by name. Root approval remains intact.

## Registration and maintenance

`src/skills/` is Host-only. Each SOP declares TypeScript data and Markdown instructions; `definition.ts` renders shared contracts and JSON recipes, while `register.ts` uses optional `ctx.inject(['skills'])` registration. Core owns 3 SOPs and Scholarly owns 4. Fibers remove registrations when components or the registry unload; a late or replaced registry rebinds automatically.

The Harness base composition supplies the `dsh-skill` registry and `dsh-tool-skill` consumer. Custom compositions need both. Versions are generated with `npm run harness:pin -- 0.2.2-alpha.2`, and npm updates the lockfile.

Test ownership: `tests/host/skills.spec.ts` covers composition and lifecycle; `tests/scholarly/skills.spec.ts` covers the external authorization catalog; `tests/host/skill-contracts.spec.ts` checks every recipe against recipe arguments, the parameter tables parsed from both language tool references, and real schema properties, with recursive nested-key checks and tool-name scans across model-facing fields; `tests/host/subagent-view.spec.ts` covers the scoped tool view and restriction lifecycle, `tests/host/subagent-guard.spec.ts` covers execution-time denial and refresh failure containment; `tests/unit/client-graph-authority.spec.ts` refuses browser imports. Tests access neither a real library nor external indexes.

Before release run focused specs, `npm run typecheck`, `npm test` and `npm run release:check`. Builds compile TS bodies directly, without copying Markdown assets. Release gates continue checking client authority, coverage, build and packaging. Parameter contracts remain in the [tool reference](tools.en.md).
