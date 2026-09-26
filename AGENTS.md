# AGENTS.md

dsh-zotero is a DeepSeek Harness plugin that lets agents search, read, and cite a local Zotero library. This file is standing orders only; product and architecture detail live under `docs/`.

## Workspace

- Work in `.`. This checkout is a **sibling** of `../deepseek-harness` (local layout on this machine — not a portable monorepo).
- Harness contracts (slots, services, web shell, client module graph, Typert) are defined upstream. Read `../deepseek-harness/docs/AGENTS.md`, `../deepseek-harness/docs/architecture.md`, `../deepseek-harness/docs/user/develop/`, and relevant `packages/*/README.md` before changing anything that depends on them. **Harness source outranks this file.**

## Map

| Path          | Owns                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `src/`        | Host half: service, tools, Local API provider, HTTP, write domain          |
| `src/local/`  | Local API domain pipelines (search/retrieve/export/changes/write/…)        |
| `src/tools/`  | 11 model tools (8 read + `create_note` / `add_tags` / `add_to_collection`) |
| `src/client/` | Browser half (settings page, Sources tab) → `lib/client.js`                |
| `tests/`      | Specs by lane; `tests/README.md` is the test rulebook                      |
| `docs/`       | Product docs, zh/en pairs                                                  |
| `scripts/`    | Build, harness pin, client-graph authority, test lint                      |
| `lib/`        | Build output — never edit                                                  |

## Sources of truth

- Architecture and data flow: `docs/architecture.md`
- Tool contracts, pagination/changes policy, write boundary, error codes: `docs/tools.md`
- Config fields, validation, hot-reload: `docs/configuration.md`
- Build details and release checklist: `docs/development.md`
- Acceptance cases (G/S/R/E/C/N/W): `docs/scenarios.md`
- Test layout and rules: `tests/README.md`
- Harness contracts: sibling `../deepseek-harness/docs/`

Keep zh/en doc pairs in lockstep when you edit one side. After machine tests pass, walk the `docs/scenarios.md` packs that cover a behavior change.

## Commands

```sh
npm install                  # sibling layout; add --no-workspaces only for a nested copy
npm test                     # test-lint + vitest (mock Zotero server)
npx vitest run <spec>        # focused unit/client test while iterating
npm run typecheck            # harness-state + tsc --noEmit (node, test, client)
npm run test:coverage        # coverage ratchets (see vitest.config.ts)
npm run build                # tsc → lib/ + esbuild → lib/client.js
npm run build:client         # browser half only
npm run format               # prettier --write
npm run format:check         # prettier --check
npm run harness:check        # version-pin consistency + upstream declaration freshness
npm run harness:pin -- <ver> # move the whole pin in one step
npm run verify:pack          # packed tarball must carry declared entries
npm run release:check        # format + harness --strict + lint + typecheck + coverage + build + pack
npm run test:integration     # live Zotero at 127.0.0.1:23119 (ZOTERO_INTEGRATION=1)
npm run link:local-harness   # symlink node_modules/@deepseek-ai/* at ../deepseek-harness
npm run dev                  # tsc --watch (host half)
npm run dev:client           # esbuild --watch (browser half)
```

## Local launch

Two flows. Pick by what you are testing:

- **Full plugin** (settings page + Zotero tab): only path that loads the browser half. Use for UI and end-to-end work.
- **Host half only (HMR)**: tools and `/zotero` with in-process hot reload. No plugin UI.

### Full plugin

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml "$DSH_HOME/"
chmod 600 "$DSH_HOME/.credentials.yaml" "$DSH_HOME/settings.yaml"
npm run build                    # lib/client.js must exist before launch
dsh plugin --profile web add .   # pnpm links this checkout; peer warnings expected
npm run dev &                    # host half: tsc --watch → lib/
npm run dev:client &             # browser half: esbuild --watch → lib/client.js
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" \
  node --import tsx/esm apps/cli/src/bin.ts web --port 3307
```

- Never reuse port **3080** (live GUI). Use 3307 (or another free port).
- Without `env DSH_HOME=…`, `dsh web` boots the real `~/.dsh` and this checkout looks missing.
- Browser half has no HMR: rebuild via watch, then refresh the page. Host half needs a dsh restart after `lib/` rebuilds.
- One-shot check: `curl -w '%{http_code}' -o /dev/null http://127.0.0.1:3307` → `200`; `grep dsh-zotero "$DSH_HOME"/profiles/web/package.json`; `grep -c conversation.view lib/client.js` ≥ 1.

### Host half only (HMR)

```sh
npm run build                                 # once; also pnpm --dir ../deepseek-harness run build
npm run dev &
cp dev-lib.cordis.yml.example dev-lib.cordis.yml  # set absolute paths inside
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

`dev-lib.cordis.yml` re-enables loader HMR, disables the profile row, and loads this checkout from `lib/`. Its `name`/`base` must be absolute. That overlay carries **no** browser half — use the full-plugin flow for UI. Alternative: `dev.cordis.yml` from the `.example` loads `src/index.ts` via tsx (still no browser half).

More detail: `docs/development.md`.

## Invariants

### Harness pin

- One exact version, currently `dsh 0.1.7-rc.2`. The `@deepseek-ai/dsh-*` line in `devDependencies` is the source of truth; `overrides`, `peerDependencies`, `engines.dsh`, and `dsh.harnessRange` are derived from it. READMEs and this file restate the same pin.
- Never edit one form alone and never use `^` / `||` — `npm run harness:pin -- <version>`, then regenerate `package-lock.json`. `scripts/harness-state.mjs` rejects dual arms.
- If the registry lags the pin, `npm run link:local-harness`. Never grant a profile `compatibility.json` exemption so this plugin runs on another dsh line.

### Plugin form

- `src/index.ts` is a pure re-export. Default export is `ZoteroService` (`static inject`, `static Config`).
- Register tools, the policy prompt, `/zotero`, and the provider in the constructor via effects (`ctx.tools.register`, `ctx.systemPrompt.section`, `ctx.inject(['commands'], …)`, `ctx.effect`). HMR unwinds them with the instance.
- `/zotero` keeps `input: { hint: 'status' }` and default `recordInput: true` so the client command-input projection can echo the typed line.
- The Typert manifest self-registers via `ctx.inject(['typert'], …)` — do not add a `./typert` package export.

### Config

- `Config` interface + Schemastery schema (every field `.volatile()`) + plain `Options`. `resolveConfig` is the only constraint authority; the live `config` getter only unwraps the Loader entry. No hard-coded tunables.

### Client graph

- Browser code is `src/client/**` plus allowlisted pure surfaces (`contract`, `settings-namespace`, `json`, `ref-grammar`, `export-items` — `scripts/client-graph-authority.mjs`). Never value-import zod, schemastery, host codecs, `src/config.ts`, or `src/typert.ts` into that graph; `npm run build:client` fails the build if you do.
- Read the mounted remote namespace via `mountedNamespace()` (`ctx.reflect.get('remote.zotero')`). Never use the dotted `ctx.remote.zotero` — it throws on a fiber that carries a runtime (`tests/client/apply.spec.ts`).
- Keep `package.json` `dsh.client.inject` equal to the rows the client entry actually needs (locale, ui-renderer, ui-settings, ui-conversation, ui-session, ui-chat, api-remotes).

### Writes

- Write tools are off by default (`writeEnabled`) and write `zotero://user/0/` only.
- Plan review belongs to the **`ctx.zotero` seam**, not to a tool: `createNote` / `updateTags` / `addToCollection` take a `ZoteroWriteCall`, answer the capability gate first, then the plan-review card. There is **no `writeConfirm` and no opt-out** — a write that cannot show its plan does not happen. Never move the gate back into a tool.
- Shell writes to the local API are turned into a harness ask (`src/shell-write-detector.ts` on `tools/pre-execute`). Never add a config field or an "off" path. Detection is text-based and is **not** containment; blind spots are documented in `docs/tools.md`.
- Writes never ride the connectivity-retry helper (a retried write is not idempotent).

### Zotero wire

- `src/search-text.ts` must stay equal to Zotero's `normalizeForSearch` (index-side fold only; returned text stays verbatim). Re-prove after a Zotero upgrade (`tests/unit/search-text.spec.ts`).
- Bare `GET .../items/{key}/children` is notes+attachments only. Annotations appear solely under `?itemType=annotation`. `meta.numChildren` never counts annotations. Mocks must not serve annotation rows on the bare path.
- Paginated array listings require a valid `Total-Results` header (fail loud). `zotero_changes` emits a `cursor` only when the read was provably complete — full policy in `docs/tools.md`.

### Sources tab

- Read tool-call rows through `ChatSnapshot` / the session projection. Never reintroduce `session.eventAt` / `snapshotEvents` / `ownEvents` (deprecated upstream). Include tool-call `phase` in the session signature so preparing→start rebuilds the workspace.

## Git

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>` (lowercase type, imperative subject, header under 72). Optional emoji right after the colon. Body: blank line, bullet points only, wrap at 72 (what and why).

## Validation

- Iterate with `npx vitest run <spec>` and `npm run typecheck` (add `npm run build:client` for browser-only work).
- Before calling a behavior change done: `npm test`, then walk the matching `docs/scenarios.md` packs.
- Before release or a cross-cutting change: `npm run release:check`.
- Coverage floors and test-size/lane ratchets only move down, in the same commit that makes the new value true (`vitest.config.ts`, `scripts/test-lint.mjs`, `tests/README.md`).

## Safety

- Network is loopback-only (`127.0.0.1:23119`); `resolveConfig` rejects anything else. Do not weaken that. No redirects, no background polling, no shell execution in the plugin itself.
- `lib/` is generated. `dev.cordis.yml` / `dev-lib.cordis.yml` are gitignored local overlays; ship the `.example` templates instead.
- A Zotero `remember:true` write key is a durable capability (stored in the Zotero profile), not a spent one — never log or commit it. Credentials live in `$DSH_HOME/.credentials.yaml` (mode `0600`).
- Disposing the plugin does **not** abort in-flight requests; they settle via the provider deadline (`tests/host/lifecycle.spec.ts`). Do not assume unload aborts.
- Zotero Local API facts (write-key protocol, batch non-atomicity, children partitions, `X-Zotero-Version`) are verified against specific builds. Re-verify after a Zotero upgrade before restating them.
