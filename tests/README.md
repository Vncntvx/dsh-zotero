# The test suite

This suite is written for the person who has to change it at 2am. Everything
below exists to keep that possible: where a spec lives, where a fixture comes
from, what an assertion is allowed to say, and what the guards will refuse.

## Layout: a spec's location is decided by what it tests

| Lane                 | Mirrors               | Holds                                                                                                                                                                                |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/`        | `src/*.ts`            | pure modules: refs, normalize, search-text, evidence, attachments, export mapping, presentation meta, config, errors, the recovery gate                                              |
| `tests/local/`       | `src/local/`          | the provider contract against the mocked Local API, one file per mechanism (search, the note scan, retrieve sources/ranking/notes/tolerance, browse, changes, get, export, identity) |
| `tests/tools/`       | `src/tools/`          | one file per tool plus `validation`, `presentation`, `connectivity-ask`, `registry-integration`                                                                                      |
| `tests/host/`        | the composition seams | lifecycle, composition, settings, remote, entry, provider gate, concurrency, doc examples, the HTTP client                                                                           |
| `tests/client/`      | `src/client/`         | the browser half, including one file per render surface                                                                                                                              |
| `tests/integration/` | live Zotero           | opt-in (`npm run test:integration`, i.e. `ZOTERO_INTEGRATION=1`); the only place a real library answers                                                                              |

Cross-cutting behaviour goes in the lane of the module it belongs to, as a
file named for the behaviour (`presentation.spec.ts`, `connectivity-ask.spec.ts`),
never in a file named after a number or a function.

The integration lane deliberately **re-asserts behaviour the mocked specs
already cover**. That is not redundancy to prune: a mock can only encode what
its author believed Zotero serves, and the live lane is what checks those
beliefs. Where an assertion exists in both places, the mock's copy specifies
the behaviour and the live copy keeps the mock honest — delete the live one and
a fixture that drifted from reality would still pass every gate.

## The shared layer

- `tests/helpers/server/keys.ts` — one canonical identity per object role
  (`ITEM_KEY`, `ATTACHMENT_KEY`, …) and the refs built from them.
- `tests/helpers/server/objects.ts` — wire-object builders (`item`, `paperItem`,
  `searchHit`, `attachment`, `noteRow`, `annotationRow`, `collectionRow`,
  `savedSearchRow`, `citationRow`, `versionHeaders`). Defaults are minimal: a
  field a test did not ask for is not on the wire.
- `tests/helpers/server/serve.ts` — route installers. Absent field = canonical
  default; `null` = serve nothing there.
- `tests/helpers/server/assert.ts` — `expectRequestPaths`,
  `expectRequestPathsAnyOrder`, `expectRequestLines`,
  `expectRequestLinesAnyOrder`, `expectRequestCount`,
  `expectHeaderOnEveryRequest`, `zoteroError`.
- `tests/helpers/lanes/host-lane.ts` — the one boot for the tool and host
  specs.
- `tests/helpers/sync.ts` — `deferred()` / `progress()` for tests that need to
  wait on the code rather than on a duration.
- `tests/helpers/fixtures-dir.ts` — the captured response bodies under
  `tests/fixtures/`, resolved from the helper so a spec can move.

## Four rules

1. **A fixture has one home.** Wire objects come from the builders above. A
   spec may pass overrides; it may not restate an object. The suite once held
   seven different objects named `ABCD1234`, including two with different
   `numChildren` for the same key — a reader could not tell a deliberate
   variation from an accident.
2. **Model-facing text is a constant, not a copy.** A message the model or the
   user reads is exported by the module that produces it and asserted by
   identity (`toContain(TAGS_LITERAL_MESSAGE)`), so a wording change edits one
   place. Each `render` keeps exactly one full-output test as its format pin;
   every other assertion checks a structural fact.
3. **Every test names a behaviour.** If you cannot finish the sentence "this
   test establishes that …", it is not a test. Two spec files once existed
   only to raise a coverage number; deleting them cost 0.26pp of branch
   coverage, which is the measurement of how little they specified.
4. **Wait on a promise you own.** A test synchronizes on something it created
   (`deferred()`, an `AbortController`, the service call under test) — not on a
   duration it guessed. Exceptions are where the timing _is_ the subject: a
   deadline's placement, an unbounded-burst peak, a TTL expiry. Those use the
   mock's own `delayJson` and say so.

## Guards

`npm run lint:test` (also the first step of `npm test`) enforces four
mechanical rules; each one exists because this repository hit it:

- no raw control bytes in source or prose — the SourcesTab spec (since split
  into `SourcesTab.*.spec.tsx`) once carried NUL bytes, which made the file
  binary to `grep`, the Read tool and `file(1)`;
- no spec over the size ratchet — `tests/tools.spec.ts` reached 2534 lines one
  review round at a time before it became `tests/tools/*`;
- every spec inside a declared lane;
- no `.only`, `.skip` or `.todo` (gate a suite with `.runIf` instead).

`vitest.config.ts` holds **coverage ratchets per layer**, each set just under
what that layer measures today. They are not aspirations: a layer earns a
higher floor by specifying more behaviour, never by touching branches to
satisfy a number. `src/local` branches (94.82%) sit below the old global gate
of 95% — a fact one global average had been hiding.

Both ratchets only move in one direction, and they move in the same commit that
makes the new value true: splitting a spec lowers the size limit, deleting
redundant tests does not lower a coverage floor.

## Not here, on purpose

- No snapshot tests: they replace one brittle assertion with a file nobody
  reads.
- No test-only shims in `src/`: a production module exports behavior, and the
  message constants above are a contract's single source rather than a
  test convenience.
- No spec written to reach a branch. If a branch is unreachable, say so in the
  code; if it is reachable but untested, that is a finding to report, not a
  test to add in a hurry.
