# Documentation Writing and Routing

This file governs writing, splitting, and moving documents under `docs/**` and the root `README*`. Repository-wide engineering rules live in the root `AGENTS.md`; test lanes and fixtures live in `tests/README.md`. Rules fall into two groups: the items under "Gates" fail a check, and the rest are enforced in review.

## Scope

- Read this file before adding, rewriting, moving, or deleting a document under `docs/`.
- `docs/x.md` and `docs/x.en.md` are a pair; update both in the same commit.
- This file is the single-language agent instruction for documentation. It has no `.en.md` and is excluded from the pair scan.
- The root `AGENTS.md` carries rules needed in every session. This file carries document ownership and writing rules. Neither copies the other.

## Fact Ownership

| Document               | Owns                                                                                                                                            | Does not own                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `product-model.md`     | Domain terms, components and user entry points, view responsibilities, system boundaries                                                        | Configuration field tables, tool parameters, build steps                                           |
| `features.md`          | What users can do, interface behavior, component enablement conditions                                                                          | Internal modules, algorithm constants, storage paths                                               |
| `architecture.md`      | Component topology, data flows, state and consistency, concurrency and resources, security boundaries, client-host contracts, design boundaries | Per-field configuration tables, tool parameter tables, pixel recipes, per-source-file walkthroughs |
| `tools.md`             | Tool names, parameters, return shapes, error codes, call examples                                                                               | Internal implementation, client layout                                                             |
| `configuration.md`     | Namespaces, fields, defaults, hot reload, enablement and disclosure rules                                                                       | Tool semantics, architecture rationale                                                             |
| `development.md`       | Build, test, debug, release workflow, and WP status                                                                                             | Runtime behavior detail                                                                            |
| `development-notes.md` | Local patches for upstream defects or missing capabilities, each with the upstream exit condition                                               | Already-adapted breaking changes, internal invariants, test or release gates                       |
| `skills.md`            | SOP names, workflows, budgets, evidence boundaries                                                                                              | Copies of tool schemas                                                                             |
| `troubleshooting.md`   | Symptoms, checks, fixes, error codes                                                                                                            | Design rationale                                                                                   |
| `tests/README.md`      | Test lanes, fixtures, ratchets, coverage floors                                                                                                 | Product behavior                                                                                   |
| `index.md`             | Reading order and navigation                                                                                                                    | Fact bodies                                                                                        |
| `plugin-detail.md`     | Marketplace component summaries                                                                                                                 | Configuration fields and implementation detail                                                     |
| `docs/AGENTS.md`       | Documentation ownership, writing rules, and gates                                                                                               | Product facts, runtime behavior                                                                    |
| Root `AGENTS.md`       | Standing repository rules                                                                                                                       | Document bodies                                                                                    |

`development-notes.md` records only upstream patches. Each entry states the upstream feature, the defect, the local patch, the compromise, and the upstream change that removes it. A migrated or no-longer-needed entry is deleted; no tombstone is kept.

## Writing Rules

- Lead with the actor, behavior, trigger, and result. A reader must be able to act or judge the outcome.
- Delete redundant negative tails. When the positive result already answers the question, drop `does not …`, `is not …`, and `does not mean …`; keep a security prohibition, API usage rule, or status distinction once in its owning reference.
- Current-state documents describe what happens now. Implementation history, WP numbers, commit hashes, and debugging transcripts belong in commit messages or a ledger entry's retirement reason.
- Drop sentences that carry no information, such as "first, it is important to clarify", "at its core", "completely", or "the highest".
- Copy identifiers, commands, paths, counts, defaults, error codes, and version strings from code or tests.
- Architecture is organized by runtime concern: topology, data flow, state and consistency, concurrency and resources, security, and client-host contracts. It does not walk through source files, and every invariant names its verification.
- Use one physical line per paragraph. Keep tables, lists, and code blocks in their existing format.
- `docs/x.md` and `docs/x.en.md` state the same facts, links, and counts. Write each language naturally; do not translate sentence by sentence.
- The ledger records upstream patches: upstream feature, defect, local patch, compromise, and upstream expectation. Internal invariants belong to `architecture.md`; build, test, and release gates belong to `development.md` and `tests/README.md`.

## Gates

- `tests/host/doc-coverage.spec.ts`: every document pair except this file exists with equal `##` counts; configuration fields, tool totals, and error-code tables match their schemas; the pair-count sentence in `docs/development.md` stays current.
- `tests/host/doc-examples.spec.ts`: example calls parse, parameters are declared, refs are valid, and tool sections include an output-field inventory.
- `scripts/harness-state.mjs`: the `harness-reviewed` marker matches the installed pin; run `npm run harness:check`.
- `npm run format:check`: prettier covers every document.
- `npm run lint:test`: spec-size ratchets. A new spec stays under 400 lines; a frozen spec keeps its exact baseline.
- Review-enforced: host `Button` and `className` rules in the root `AGENTS.md`; ledger field and `DN-` reference integrity in `tests/host/development-notes.spec.ts`.

A new top-level `docs/*.md` enters the pair and example scans automatically, except this single-language agent instruction. Create its `.en.md` in the same commit, add its entry to `docs/index.md`, and change the pair count in `docs/development.md` to the actual number.

## Moving One Fact

1. Find its single owner under "Fact Ownership". If none fits, decide the owner first; do not copy the fact into several documents.
2. Confirm the target already states the constraint and its verification: a test, a command, or a gate.
3. Write it once in the target; other documents link to that path.
4. Update `.en.md` in the same commit, except for this file. When adding or removing a document pair, update `docs/index.md` and the pair count in `docs/development.md`.
5. An upstream patch that is no longer needed is deleted, not tombstoned. A migrated internal constraint lives in its owning page; a test or release rule lives in `tests/README.md` or `development.md`.
