<p align="right"><a href="development-notes.md"><b>中文</b></a></p>

# Development Notes

<!-- harness-reviewed: 0.2.2-rc.4 -->

Current host contract review: 2026-11-18, pin `0.2.2-rc.4`. This page keeps upstream patches only; every entry has been checked against the current implementation and tests.

## Position

This page records one situation only: we use an upstream capability (`deepseek-harness` or an external tool), but an upstream defect, incompleteness, or missing capability forces a local patch while we wait for a better upstream replacement. An upstream breaking change that we have already adapted to is not recorded. Internal architecture constraints, test gates, and release gates belong to `architecture.md`, `tests/README.md`, and `development.md` and are not repeated here.

## Entry Requirements

- **Upstream**: which host or external tool provides the capability, and the current pin or version.
- **Upstream feature**: the capability we use.
- **Upstream defect**: why the public upstream contract cannot be used directly; state the symptom and impact.
- **Local patch**: how this repository works around it, including the symbols involved.
- **Why this is a compromise**: the assumptions, costs, and things the patch cannot do.
- **Upstream expectation**: the capability that would let us delete the patch; state a decidable condition.
- **Review trigger**: when to re-check, and which upstream file, symbol, or command to inspect.
- **Verification**: how tests prove the patch.
- **Follow-up**: the removal or migration steps once upstream satisfies the expectation.

## Upgrade Review

On every harness pin bump, check each entry's "upstream expectation": if it is now provided, migrate and delete the entry in the same change; if not, update only the pin and review date. Do not add an entry for a breaking change that is already adapted.

## DN-1: Suppressing panel parse completion notices

- **Upstream**: `@deepseek-ai/dsh-jobs` and `dsh-tool-jobs` (pin `0.2.2-rc.4`).
- **Upstream feature**: a panel parse job runs through `ctx.jobs`, and settlement posts a background-job status notice to the owning session.
- **Upstream defect**: the notice only asks the model to read the job output; a parse job's output is a receipt (artifactId, character count, bounded preview) with no body or readable path. An idle session is woken by `followup`, the model searches the host filesystem, and it produces an unsolicited report.
- **Local patch**: `EnrichmentParseJobs` in `src/enrichment/parse-jobs.ts` registers the job with `owner`, leaves `toolCall` empty, and holds overlapping `ctx.jobs.wait` successors (`holdNotice`, `PARSE_NOTICE_WAIT_MS`, `PARSE_NOTICE_REARM_MS`); settlement is marked `awaited`, so the tool-jobs delivery condition skips it. The waiters consume no output, cancel no job, and remove no settlement record.
- **Why this is a compromise**: `awaited` means "some caller received the terminal projection", not "the model should not know about this job"; any consumer that treats `awaited` as "the model consumed it" receives a false signal. The successor chain relies on Node timer ordering and microtask draining.
- **Upstream expectation**: add `notify?: false` (or `modelFacing?: false`) to `JobSpec` and carry it to `JobSettledData`; or expose `toolCall` on `JobView` so tool-jobs notifies only tool-created jobs. Either one deletes this patch.
- **Review trigger**: after every `npm run harness:pin`; search `notify`/`silent`/`modelFacing` in `node_modules/@deepseek-ai/dsh-jobs/src/types.ts`, search `toolCall` in `view.ts`, and check whether tool-jobs still skips only `awaited`.
- **Verification**: `tests/host/enrichment-parse-jobs-notice.spec.ts` covers completed, failed, killed, and cross-window cases, all `awaited === true`; deleting `holdNotice` must make them fail.
- **Follow-up**: use the new declaration or provenance inference; delete `holdNotice` and the two constants; replace the spec assertions with "a panel parse produces no notice, while a model-started background job still notifies"; sync `architecture.md` and `AGENTS.md`.

## DN-5: Package smoke must escape the parent npm dry-run mode

- **Upstream**: npm 12 lifecycle.
- **Upstream feature**: `npm publish --dry-run` runs `prepublishOnly`, and the smoke nests `npm pack`.
- **Upstream defect**: `npm_config_dry_run=true` is inherited, the nested pack produces zero tarballs, and `verify:pack` fails.
- **Local patch**: `scripts/smoke-archive-worker.mjs` removes the variable from the child environment; other npm settings still inherit.
- **Why this is a compromise**: it covers this smoke chain only; a new nested npm call must be re-checked.
- **Upstream expectation**: npm stops passing dry-run to lifecycle children or offers an explicit opt-out.
- **Review trigger**: release script chain, npm major, or a new child process; rerun `npm publish --dry-run`.
- **Verification**: the dry-run log contains `archive-worker pack smoke ok` and `verify-pack ok`; `release:check` passes.
- **Follow-up**: delete the environment scrub and keep the "smoke produces one real tarball" assertion.

## DN-7: Vendoring the semantic runtime into the package

- **Upstream**: pnpm 11 `strictDepBuilds`; `onnxruntime-web` transitively depends on `protobufjs`, which ships an empty `postinstall`.
- **Upstream feature**: local semantic ranking uses onnxruntime-web.
- **Upstream defect**: an undecided dependency build script makes the whole pnpm install exit non-zero (`ERR_PNPM_IGNORED_BUILDS`), and desktop plugin installation rolls back.
- **Local patch**: the runtime is not a dependency but a packaged asset: `scripts/vendor-onnxruntime.mjs` copies the Node entry, wasm glue, and binary into `assets/onnxruntime/<version>/`, writes `provenance.json` (source, bytes, SHA-256) and the MIT license; `semantic/runtime.ts` loads the entry by absolute URL and points `env.wasm.wasmPaths` at that directory; `verify:pack` checks hashes, the license, and that the three files are in the package.
- **Why this is a compromise**: the assets are generated and must be rebuilt on upgrades; `onnxruntime-common` remains a normal dependency; the package grows by about 3.8 MB.
- **Upstream expectation**: pnpm allows or exempts the build script, or `protobufjs` 8.x ships no `postinstall`.
- **Review trigger**: onnxruntime-web upgrade (also update `SEMANTIC_RUNTIME_VERSION` and the exact devDependency), pnpm major, or a new runtime dependency.
- **Verification**: `vendor-onnxruntime.spec.ts`, `enrichment-semantic-runtime.spec.ts`, `build-approvals.spec.ts`, `verify-pack.spec.ts`; install the packed artifact into a clean profile with pnpm 11 and expect zero approvals.
- **Follow-up**: move the runtime back to dependencies and delete the vendor script, packaged assets, and related guards.

## DN-9: The upstream "no session surface" refusal is prose only

- **Upstream**: `@deepseek-ai/dsh-client-ui-sidebar-right` (pin `0.2.2-rc.4`).
- **Upstream feature**: the panel opens a local PDF through `openResource`.
- **Upstream defect**: when the session has no mounted surface, upstream throws `new Error('sidebarRight: no session surface is mounted')` with no error code or distinguishable type.
- **Local patch**: a `NO_SESSION_SURFACE_REFUSAL` substring constant, matched with `includes` because upstream prefixes `sidebarRight: `; other failures keep their original message.
- **Why this is a compromise**: the message text is the only discriminator, so an upstream wording change breaks it.
- **Upstream expectation**: an error code or error type for this branch.
- **Review trigger**: every pin; run `rg "no session surface is mounted" ../deepseek-harness/packages/client/ui-sidebar-right/src`.
- **Verification**: `tests/client/library/library-panel.reader.spec.tsx` (the refusal becomes a panel message; a foreign refusal keeps its message).
- **Follow-up**: branch on the code and delete the substring constant.

## DN-10: Client loader API and `resultText` mirror the pin semantics

- **Upstream**: the client module loader and `resultText` (pin `0.2.2-rc.4`).
- **Upstream feature**: plugin CSS injection and the `load({id,factory})` handoff; `resultTextOf` produces tool-card text.
- **Upstream defect**: the rc.4 shell provides `load({id,factory})` and claims styles injected during factory execution. `@deepseek-ai/dsh-client-modules/client` exports `ClientBundleRegistration`, whose rc.4 shape has no `meta` field. `resultText` joins with newlines and has no public export.
- **Local patch**: `CLIENT_LOADER_API` and `assertLoaderApi` in `scripts/build-client.mjs`; the `resultTextOf` mirror in `src/sources/presenters.ts`, with JSDoc recording the released contract.
- **Why this is a compromise**: both mirrors must move with the pin; a build-time failure is better than silently losing styles or the handoff at runtime.
- **Upstream expectation**: the pin provides `meta.stylesheets`; `resultText` is exported from `./client`.
- **Review trigger**: every pin; use the commands in `development.en.md` to inspect the loader, registration type and result text at the release tag.
- **Verification**: `build-client-bundle.spec.ts` (old form passes; each drift fails), `presenters.spec.ts`, `build:client`, `harness:check`.
- **Follow-up**: flip the constant, migrate style injection, raise the `engines.dsh` floor; delete `data-plugin-css` and the constant; value-import `resultText` and delete the mirror.

## DN-13: Proxy routing and address pinning are mutually exclusive

- **Upstream**: `@deepseek-ai/dsh-http-proxy` and undici.
- **Upstream feature**: proxy routing and address pinning for external egress.
- **Upstream defect**: the proxy performs its own DNS, so addresses cannot be pinned at the same time; `pinned.dispatcher` is accepted only by the same undici copy's `fetch`.
- **Local patch**: `egressRouteFor`, `proxyRouteFor`, and `publicFetch` in `src/transport/connections.ts`: proxied requests use the package's process-level dispatcher (never closed, lexical public gate still runs), direct requests resolve, pin the closed address set, and close per attempt; the plugin resolves Undici from the installed Harness HTTP proxy, so profile and CLI package layouts share the dispatcher and fetch module.
- **Why this is a compromise**: proxied requests rely on the proxy's DNS, direct requests on the local resolver; combining them would abandon check-then-connect.
- **Upstream expectation**: one upstream API that combines proxy routing with address pinning.
- **Review trigger**: harness proxy version, undici replacement, or a new external egress. `harness:check` verifies the shared repository lockfile entry. The packed install smoke checks that the plugin fetch is the function exported by the proxy’s installed Undici. `deps:check` reports releases above the host constraint.
- **Verification**: `tests/host/*-proxy*`, `tests/scholarly/network.spec.ts`, `fake-ip-policy.spec.ts`, and the test-lint fetch-ownership check.
- **Follow-up**: delete `egressRouteFor` and use the combined API.

## DN-17: Style-token pin sources

- **Upstream**: the host theme and token sources at the pin.
- **Upstream feature**: client CSS consumes host tokens and `style:check` verifies it.
- **Upstream defect**: there is no complete public token manifest; sources are the theme sheets and runtime seams.
- **Local patch**: `scripts/style-tokens.mjs` reads the lockfile-installed exact theme in CI and the sibling pin tag for linked development; `RUNTIME_SEAMS`/`verifyRuntimeSeams` map each seam to a setting, CSS definition, or `setProperty` call; the source table and snapshot stay closed.
- **Why this is a compromise**: it depends on pinned internals, so a moved definition fails the gate.
- **Upstream expectation**: a complete public token manifest.
- **Review trigger**: pin, new token, or a moved upstream definition.
- **Verification**: `tokens:check` (inside `release:check`) and `style-tokens.spec.ts`.
- **Follow-up**: replace the source table with the public manifest and keep the exact pin and deletion checks.

## DN-24: Upstream mirrors, static lists, and search folding

- **Upstream**: Cordis enums, the Typert generator, tool execution, and Zotero search internals.
- **Upstream feature**: service state/log enums, Typert RPC, dynamic write-tool registration, and search folding.
- **Upstream defect**: const enums have no runtime object; the Typert generator requires a monorepo layout; the panel's `tools.execute` carries no toolSet, so `when` cannot replace the registration lifecycle; Zotero's `normalizeForSearch` is an internal implementation.
- **Local patch**: type-anchored numeric mirrors and exhaustive tables in `src/fiber-state.ts`; a strict descriptor table in `src/typert.ts` that derives host and browser members; dynamic write-tool registration; a `src/search-text.ts` mirror plus `scripts/verify-zotero-search.mjs`.
- **Why this is a compromise**: the mirrors must be reviewed on every pin/Zotero upgrade; the verifier treats the real source as authority and never generates expectations from the mirror.
- **Upstream expectation**: runtime enum exports; a Typert generator usable outside a monorepo; a toolSet for panel execution; a stable Zotero search contract.
- **Review trigger**: pin, enum/log changes, tool execution semantics, generator layout, Zotero upgrade, or `search-text.ts` changes.
- **Verification**: `npm run typecheck`, `typert-parity`, remote contract and write-policy tests, `verify-zotero-search.mjs`.
- **Follow-up**: delete a mirror when runtime exports appear; migrate when the generator supports a standalone repository; re-evaluate dynamic registration when a toolSet is available; on a search-equivalence failure, check the real source version first.

## DN-27: Tool parameter names are closed before execution

- **Upstream**: the tool parameter DSL (rc.4).
- **Upstream feature**: tool registration and parameter validation.
- **Upstream defect**: the DSL produces an open root object, so unknown root parameters are accepted.
- **Local patch**: the shared constructor marks the public schema `additionalProperties: false` and, on an unknown root parameter, calls the host `validateJsonSchemaValue` and throws `ToolArgsError` before any tool executes; declared fields still go through `defineTool`; unique approximate matches cover missing required/optional names without guessing ambiguous ones.
- **Why this is a compromise**: the local closure layer duplicates part of the host contract; dynamic background parameters are available only while registered.
- **Upstream expectation**: the host exposes a DSL for closed parameter roots.
- **Review trigger**: tool DSL, execution pipeline, argument error type, or new tools/dynamic parameters.
- **Verification**: `tool-parameter-closure` (all 30 real registrations and a zero-side-effect refusal), `parameter-correction`, and local/scholarly behavior tests.
- **Follow-up**: use the host capability and delete the local root-name refusal branch.

## DN-29: Public test support and registry entry differences

- **Upstream**: test-support packages (rc.4).
- **Upstream feature**: host-lane `executeModelToolFixture`, `TestClient`/`SlotTestRuntime`, and published entries.
- **Upstream defect**: the complete runtime root entry depends on loader-form `/client` artifacts; a package-internal Vitest 4 and the repository's Vitest 5 can split.
- **Local patch**: an exact published-entry list in the test-support source gate; `client-test-platform.mjs` maps declared type paths to explicitly published production sources and fails on a missing contract or file; a single Vitest instance; real `TestClient`/`SlotTestRuntime`; the pin script fills harness overrides.
- **Why this is a compromise**: the source map is a maintained list; a missing file fails the gate.
- **Upstream expectation**: `/client` entries published as directly executable ESM.
- **Review trigger**: test-support packages, client loader, test runner, or pin writer.
- **Verification**: host/tool real calls, `harness-state`, `test-lint`, locale/client DOM/release checks.
- **Follow-up**: delete the published-source map and entry exceptions.

## DN-40: Host deliverable button private-route adapter

- **Upstream**: `deliverables.file.actions` at the pin.
- **Upstream feature**: the deliverable-file action.
- **Upstream defect**: owner props provide no file path.
- **Local patch**: accept only `api/present.open` with one `sessionId`, a positive integer `seq`, and a nonnegative integer `index`, then locate the file through ChatSnapshot; log unknown routes or coordinates; keep the file context menu.
- **Why this is a compromise**: the private route is not a public contract; a change in the coordinate shape breaks it.
- **Upstream expectation**: a public path or file identity.
- **Review trigger**: pin, present-open route, or slot owner props.
- **Verification**: `tests/client/deliverables/`, `smoke:web-composition`.
- **Follow-up**: use the public field and delete the parser.

## DN-42: Button style ownership and content-row layout

- **Upstream**: the host `Button` at the pin.
- **Upstream feature**: every control uses the host Button.
- **Upstream defect**: only fixed block sizes `md`/`sm` exist; there is no intrinsic-content-height option.
- **Local patch**: `ContentButton` uses native `style.height="auto"` as its only host override; the title, metadata, and padding determine row height; shared IconButton adapter styles own icon geometry and narrow-pane icon seats; business styles override neither host colours nor geometry.
- **Why this is a compromise**: it is a restricted exception; type, horizontal padding, corners, hover, and focus still come from the host.
- **Upstream expectation**: a content-height or icon-button API.
- **Review trigger**: Button content-height/icon API, size ladder, or a new wrapper.
- **Verification**: the `control-style-ownership` gate (JSX imports to CSS; only `height:auto` and icon dimensions/radius are allowed); real browser acceptance.
- **Follow-up**: replace the adapter with the host API and keep the ownership gate.

## DN-43: Result projection and the host snapshot

- **Upstream**: `createSuccessResult` in the tools pipeline.
- **Upstream feature**: tool result projection and `presentationMeta`.
- **Upstream defect**: the host copies and freezes the result before verification and projection, so a WeakMap on the original result cannot carry later facts.
- **Local patch**: the inline arm computes once in the final `presentationMeta`; the file arm computes once after deciding a file is needed and keeps the facts with the receipt; event metadata expands one copy.
- **Why this is a compromise**: facts must be computed before the snapshot; a second projection cannot recover them.
- **Upstream expectation**: a call-level projection interface that survives the snapshot.
- **Review trigger**: tools pipeline, result wrapper, or projection changes.
- **Verification**: `tests/host/result-projection.spec.ts` (each arm's projector runs once; metadata has no nested facts or session copies).
- **Follow-up**: revisit delivery when the upstream interface exists and keep the two-arm execution regression.

## DN-49: Interface-language injection for explain answers

- **Upstream**: client `ctx.locale` and model requests at the pin.
- **Upstream feature**: explain and ask answers follow the interface language.
- **Upstream defect**: the active interface language exists only in the browser; host and model requests do not carry it.
- **Local patch**: `src/client/answer-language.ts` writes the language name (for example, `Simplified Chinese (简体中文, zh)`) into `parsedExplainPrompt` and `libraryAskFulltextPrompt`.
- **Why this is a compromise**: the prompt carries a display name; a new locale must first be nameable through `Intl.DisplayNames`.
- **Upstream expectation**: the host exposes the interface language to the model.
- **Review trigger**: `ctx.locale` service, prompt shape, or a new locale.
- **Verification**: `tests/client/answer-language.spec.ts`, `tests/client/library/parsed-document-*.spec.tsx`, `library-inspector.spec.tsx`.
- **Follow-up**: delete the client injection when the host exposes the language; keep the explain/ask behavior constraints.
