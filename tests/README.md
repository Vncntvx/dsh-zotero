# The test suite

This suite is written for the person who has to change it at 2am. Everything
below exists to keep that possible: where a spec lives, where a fixture comes
from, what an assertion is allowed to say, and what the guards will refuse.

These rules apply to new and changed specs, helpers, fixtures, and test setup.
The Guards section distinguishes automated checks from review requirements;
a rule does not become optional because lint cannot check it yet. Existing
files migrate incrementally under the size and migration rules below.

## Layout: a spec's location is decided by what it tests

| Lane                 | Mirrors               | Holds                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/`        | `src/*.ts`, tooling   | pure modules: refs, normalize, search-text, evidence, attachments, export mapping, presentation meta, config, errors; build, pack, and test guard contracts belong under `unit/tooling/`                                                                                                    |
| `tests/local/`       | `src/local/`          | the provider contract against the mocked Local API, one file per mechanism (search, the note scan, retrieve sources/ranking/notes/tolerance, browse, changes, get, export, identity, the scope directory) plus the write domain (notes, tags, membership, collections, items, library tags) |
| `tests/tools/`       | `src/tools/`          | a file per tool that carries its own behaviour (the write tools share `write-tools`, `write-presentation`, `write-item-presentation`, and `write-approval-policy`), plus `validation`, `presentation`, `registry-integration`                                                               |
| `tests/host/`        | the composition seams | lifecycle, composition, settings, remote, entry, provider gate, concurrency, doc examples, the HTTP client, and the write seams (auth, gate, HTTP, shell-write approval, status)                                                                                                            |
| `tests/client/`      | `src/client/`         | the browser half, including one file per render surface                                                                                                                                                                                                                                     |
| `tests/scholarly/`   | `src/scholarly/`      | the external scholarly literature search, fusion ranking, fulltext retrieval, and citation verification subsystem                                                                                                                                                                           |
| `tests/integration/` | live Zotero           | opt-in: `npm run test:integration` sets `ZOTERO_INTEGRATION=1` and runs the read spec only. The write probe needs `ZOTERO_WRITE_PROBE=1` as well and is not part of that script. The only place a real library answers                                                                      |

Cross-cutting behaviour goes in the lane of the module it belongs to, as a
file named for the behaviour (`presentation.spec.ts`, `validation.spec.ts`),
never in a file named after a number or a function.

### Module ownership and splitting

- Keep the seven root lanes. A lane identifies ownership, not test cost or
  level: a client reducer can be pure, while a tool execution spec can mount
  the host. Apply the verification levels below within each lane.
- Within a lane, group related specs by module, then name files for behaviours.
  Use `local/search/parameters.spec.ts`, `local/write/batch-verdicts.spec.ts`,
  `client/library/request-races.spec.tsx`, or
  `scholarly/sources/openalex/parsing.spec.ts`. A small module may keep one
  spec directly in its lane; create a directory when it needs several
  behaviour specs or dedicated support. Do not create empty scaffolding.
- A production file may have several specs. Split along independent behaviour
  or resource boundaries, not by line ranges or individual functions. For
  example, separate write presentation from approval execution, and fulltext
  markup from disk storage. Avoid `extra`, `misc`, `part2`, and `coverage` names.
- Group scholarly adapter tests by source. Keep routing, source-registry
  completeness, and fusion contracts in their own modules rather than mixing
  them into files spanning every adapter's parsing and requests.
- Library tests retain their ownership across lanes: pure view mapping under
  `unit/library/`, host composition and write entry under `host/library/`, and
  browser behaviour under `client/library/`. Do not duplicate a suite to make
  a feature appear under one directory.
- For a new or substantially reorganized module, record its production scope,
  test locations, primary verification levels, and relevant acceptance packs
  in a short module README or the change description. Update that record when
  ownership changes; do not maintain a second inventory of every test case.

### Verification levels and behaviour ownership

Use the smallest real assembly that can establish the behaviour. Keep real
module internals and substitute external boundaries; do not rebuild the
production algorithm inside a mock.

| Level                           | Establishes                                                              | Assembly and substitutions                                                             |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Pure logic                      | refs, normalization, ranking, reducers, parameter encoding, presentation | Direct calls; no host, HTTP server, or unrelated temporary directory                   |
| Module behaviour                | domain pipelines, feeds, resolvers, state machines                       | Real collaborating modules; controlled HTTP, clock, or filesystem boundary as needed   |
| Contract                        | wire shapes, stable errors, remote parity, source formats                | Real codecs/validators and independently specified valid and invalid samples           |
| Composition                     | registration, injection, entry routing, approval, disposal               | Minimal necessary host services; scripted Zotero or scholarly boundary                 |
| Live integration and acceptance | actual protocol assumptions, browser behaviour, model tool use           | Explicitly enabled real Zotero/Harness sessions and matching `docs/scenarios.md` packs |

Each behaviour has a primary verification level. Exhaustive query encoding
and pagination cases belong to local/transport tests; tool tests prove input
mapping and a representative execution path. Exhaustive write merging and
conflict cases belong to the write domain; entry tests prove routing and
settlement. Feed tests own stale-response rules; panel tests retain a
representative visible interaction. Common HTTP error matrices are not
repeated for every tool unless the tool has distinct error behaviour.

Preserve entry-specific approval checks for tools, the library panel, and
scholarly save: each must prove it reaches the `ctx.zotero` policy seam and
cannot write after approval refusal. Shared write rules may use a named
contract runner, but operation-specific semantics remain in dedicated specs.
Use registry/parity checks for completeness over declared capabilities.

The integration lane deliberately re-asserts behaviour the mocked specs
already cover. That is not redundancy to prune: a mock can only encode what
its author believed Zotero serves, and the live lane is what checks those
beliefs. Where an assertion exists in both places, the mock's copy specifies
the behaviour and the live copy keeps the mock honest. Delete the live one and
a fixture that drifted from reality would still pass every gate.

Default tests use controlled dependencies and make no real external service
requests. Live tests remain opt-in; real writes keep the separate write-probe
gate and use a disposable test library. Record live checks that were not run
instead of reporting a mocked pass as live verification.

## The shared layer

- `tests/helpers/server/keys.ts`: one canonical identity per object role
  (`ITEM_KEY`, `ATTACHMENT_KEY`, …) and the refs built from them.
- `tests/helpers/server/objects.ts`: wire-object builders (`item`, `paperItem`,
  `searchHit`, `attachment`, `noteRow`, `annotationRow`, `collectionRow`,
  `savedSearchRow`, `citationRow`, `versionHeaders`). Defaults are minimal: a
  field a test did not ask for is not on the wire.
- `tests/helpers/server/serve.ts`: route installers. Absent field = canonical
  default; `null` = serve nothing there.
- `tests/helpers/server/assert.ts`: `expectRequestPaths`,
  `expectRequestPathsAnyOrder`, `expectRequestLines`,
  `expectRequestLinesAnyOrder`, `expectRequestCount`,
  `expectHeaderOnEveryRequest`, `zoteroError`.
- `tests/helpers/lanes/host-lane.ts`: the one boot for the tool and host
  specs, plus `commitLive` (the loader-shaped live config commit the settings
  and diagnostics specs share) and `expectValue` (the success-arm settle).
- `tests/helpers/error-expectations.ts`: `expectZoteroError`, the one
  stable-code rejection assertion the transport specs share.
- `tests/helpers/recording-sink.ts`: `recordingSink`, the line-capturing
  `DiagnosticSink` the transport diagnostics specs assert against.
- `tests/helpers/provider-harness.ts`: the provider lane's single import
  surface: mock + provider boot, request builders, and `PROVIDER_LIMITS`, the
  one `LocalApiLimits` base every spec overrides.
- `tests/helpers/test-clients.ts`: `testHttpClient` / `testWriteClient`, the
  suite's standard transport bounds; a spec passes only what it varies.
- `tests/helpers/approval-stub.ts`: the one `approval` seam the write lanes
  compose (`StubApproval`, its request ledger, and the scripted outcome).
- `tests/helpers/write-domain-fixtures.ts`: the write-domain specs' one home
  for mock shape and constants. It carries `itemJson`, `batchBody`/`batchHeaders`,
  `writeDeps` (the full domain seam over a mock), `serveItemRead` (one item
  read, parameterizable by key/data/body/serverId/version), `grantAuthorize`
  and `startWriteDomainMock` for the authorize dialog and the baseline routes,
  and `expectApplied`.
- `tests/helpers/sync.ts`: `deferred()` / `progress()` for tests that need to
  wait on the code rather than on a duration.
- `tests/helpers/fixtures-dir.ts`: the captured response bodies under
  `tests/fixtures/`, resolved from the helper so a spec can move.

### Support ownership and dependencies

- Keep a helper local when only one spec uses it. Put module-shared setup and
  fixtures in that module's `support/`; promote to `tests/helpers/` only when
  independent modules share the same contract. Existing helper locations may
  migrate gradually; move their definition instead of copying it.
- Dependencies flow from specs to module support to public shared helpers.
  Shared helpers never import module support; support modules never import
  specs; specs never import other specs. Keep the helper graph acyclic.
  Browser support must preserve the client graph boundary and must not import
  host runtime code to manufacture client views.
- Keep wire objects, domain objects, and client views as separate typed
  builders. Defaults stay minimal and each spec states the variation it
  depends on. Deliberately malformed wire samples may be literal objects:
  a builder must not silently repair the invalid input being tested.
- Helpers provide objects, resource ownership, synchronization, and explicitly
  named common assertions. Keep case-specific expected results in the spec;
  do not hide them in a generic scenario runner or add mode flags for unrelated
  workflows. A mount helper and a fixture catalogue have separate duties.
- Captured JSON/XML and other protocol samples have adjacent provenance
  documentation: source, format/API version when known, capture date, and
  sanitization. Label synthetic samples as synthetic. Never store credentials
  or personal-library content in a fixture.

## Four rules

1. **A fixture has one home.** Wire objects come from the builders above. A
   spec may pass overrides; it may not restate an object. The suite once held
   seven different objects named `ABCD1234`, including two with different
   `numChildren` for the same key, so a reader could not tell a deliberate
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
   (`deferred()`, an `AbortController`, the service call under test), not on a
   duration it guessed. Exceptions are where the timing _is_ the subject: a
   deadline's placement, an unbounded-burst peak, a TTL expiry. Those use the
   mock's own `delayJson` and say so.

### Case writing and resource ownership

- Name a case for its condition and observable result, such as "keeps the
  newer page when an older request settles last". One case establishes one
  behaviour; several assertions may establish that behaviour's outcome,
  audit record, and absence of side effects.
- Use `.spec.ts` or `.spec.tsx`. Prefer behaviour names within module
  directories; component-specific specs may retain the component's name.
  Existing names change as their module is reorganized, not in bulk for style.
- Use table-driven cases only when the execution flow is the same and inputs
  and expected results vary. Give rows diagnostic names. Different approval
  or recovery flows stay explicit instead of sharing a branching runner.
- Scope setup to the cases that need it. A pure render or encoding test must
  not start a host or server because a neighbouring execution test needs one.
  Use existing service/provider seams; do not add test-only exports, production
  flags, or private-state access to avoid real composition.
- Assert business results at the domain boundary, requests at the protocol
  boundary, and visible behaviour at the UI boundary. Assert complete request
  order only when order is part of the contract. Exported message constants
  prove selection, not wording correctness: keep independent expectations for
  stable codes, approval meaning, evidence provenance, and the format pin.
- Keep unsafe casts local to deliberately invalid-input or external-stub
  boundaries and explain them. Ordinary fixtures must satisfy their types;
  do not silence contract drift with `as never` or double casts.
- A harness declares and releases every resource it creates: service/context
  registrations, HTTP servers, temporary files, DOM trees, timers, and global
  stubs. Make disposal ownership explicit and await asynchronous cleanup;
  settle owned in-flight operations according to the production deadline
  contract rather than assuming plugin disposal aborts them.
- Scope DOM shims and browser setup to browser tests. When changing shared
  setup, keep Node tests free of client compatibility mocks. Any upstream API
  fallback must state the affected version and removal condition, and retain
  a real-package composition or build check that can expose upstream drift.
- Restore fake clocks, mocks, and globals after use. No test may depend on
  execution order, another test's mutable fixture, credentials, or a personal
  library. Do not enable retries to hide an unexplained failure.

### Complexity budgets

These are review requirements until corresponding automation is added:

- A new spec stays at or below 400 lines and a new helper at or below 300
  lines. Count the complete file, including setup and comments. First split
  by responsibility; moving the same complexity into one oversized helper
  does not satisfy the rule.
- Existing files above these budgets are grandfathered at their pre-change
  size and must not grow. An exception to a review budget must identify the
  path, reason, and follow-up in the change description. It cannot exceed the
  automated global spec limit or relax a coverage ratchet.
- Review module-wide cost as well as file size: required support imports,
  repeated error matrices, setup cost, and files changed for one behaviour.
  Do not cap test counts or total module lines merely because a feature grew.
- Measure per-module runtime and variability before adding performance gates.
  Establish budgets from repeatable runs; do not invent timing limits or use
  retries to make a budget pass.

## Guards

`npm run lint:test` (also the first step of `npm test`) enforces five
mechanical rules; each one exists because this repository hit it:

- no raw control bytes in source or prose. The SourcesTab spec (since split
  into `SourcesTab.*.spec.tsx`) once carried NUL bytes, which made the file
  binary to `grep`, the Read tool and `file(1)`;
- no spec over the size ratchet. `tests/tools.spec.ts` reached 2534 lines one
  review round at a time before it became `tests/tools/*`;
- every spec inside a declared lane;
- no `.only`, `.skip` or `.todo` (gate a suite with `.runIf` instead);
- no file extension under the text roots that is neither a declared text
  extension nor a declared binary one, so an asset type is skipped only after
  someone decided it should be.

`vitest.config.ts` holds coverage ratchets per layer, each set just under
what that layer measures today. They are not aspirations: a layer earns a
higher floor by specifying more behaviour, never by touching branches to
satisfy a number. `src/local` measured 94.82% branches while the global read
96.43%: a layer under the 95% the global gate carries, hidden by layers far
above it. It now carries its own floor of 93, named in the open rather than
averaged away.

Both ratchets only move in one direction, and they move in the same commit that
makes the new value true: lower the size limit when splitting reduces the
suite's actual maximum; deleting redundant tests does not lower a coverage
floor. New module coverage floors require measured evidence, and directory
moves must preserve the coverage include/exclude and threshold scope.

The module layout, behaviour ownership, helper dependency rules, resource
ownership, and 400/300-line budgets above are enforced by review today. The
current lint does not check them. When adding automation, use an import graph
for dependency rules and a path-specific baseline for oversized existing
files; neither may silently exempt new violations. Add checks to the existing
test lint entry point where appropriate and test the checks themselves.

## Migration and validation

1. Record the affected module's spec names/count, fixture owners, coverage
   scope, and verification responsibilities before moving it. Measure runtime
   before claiming a performance improvement.
2. Move files and repair imports in a separate change from deleting cases or
   changing assertions. A move preserves the collected case names/count and
   behaviour. Preserve test discovery and both Node/client typecheck scopes.
3. Separate pure logic from composition, then split mixed responsibilities.
   Start with `client/library`, scholarly source adapters, and `local/write`;
   keep each migration small enough to review independently.
4. Consolidate support definitions and cleanup ownership without introducing
   helper cycles. Before removing overlap, identify the primary test and the
   retained live-protocol or write-entry checks.
5. Run focused specs and `npm run typecheck`; add `npm run build:client` for
   browser changes. Behaviour changes also require `npm test` and the relevant
   acceptance packs. Shared test infrastructure or other cross-cutting changes
   require `npm run release:check`. Report unexecuted live acceptance checks.

Documentation-only rule changes need focused formatting and test-lint checks.
They do not require running the behavioural suite when no executable files
change.

When changing CI, run the complete deterministic quality gate on PRs and make
release publishing depend on a successful gate for the same source commit.
Affected-module selection is a development shortcut, not the sole merge gate.
Keep scheduled dependency-health checks and explicit live integration as
separate checks; neither substitutes for PR validation. These are requirements
for CI changes, not a claim that the current workflows already enforce them.

## Not here, on purpose

- No snapshot tests: they replace one brittle assertion with a file nobody
  reads.
- No test-only shims in `src/`: a production module exports behavior, and the
  message constants above are a contract's single source rather than a
  test convenience.
- No spec written to reach a branch. If a branch is unreachable, say so in the
  code; if it is reachable but untested, that is a finding to report, not a
  test to add in a hurry.
