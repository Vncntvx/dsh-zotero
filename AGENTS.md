# AGENTS.md

## Workspace and source of truth

- All work happens directly in this folder (`.`), an independent git reponested inside the harness checkout.
- The dsh source is the parent checkout (`..`). Its docs live under `../docs/` (`docs/AGENTS.md`, `docs/architecture.md`, `docs/user/develop/`,`docs/subsystems/`, `docs/cookbook/`) and in each `packages/*/README.md`.
- When a task touches harness contracts (slots, services, the web shell, the client-module graph, Typert), consult the harness source and docs first, the source is authoritative over this file.

## Git commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, types lowercase (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `build`, `ci`, `revert`), subject in imperative mood, header under 72 chars. Optionally place an emoji matching the type right after the colon, before the subject. Body: blank line, bullet points only, each item wraps at 72, what and why.

## Commands

```sh
npm install --no-workspaces  # this checkout sits inside the deepseek-harness workspace
                             # tree; the parent's workspaces field otherwise hijacks npm
npm run typecheck            # tsc --noEmit for the node, test, and client projects
npm test                     # vitest unit tests against the mock Zotero server
npm run test:coverage        # 100% coverage gate on src/; src/index.ts and src/types.ts
                             # excluded (pure re-export / types-only)
npm run build                # tsc emits the node half into lib/; esbuild emits the
                             # browser half lib/client.js (with a loader-handoff self-check)
npm run build:client         # rebuild the browser half only
npm run dev                  # tsc --watch
npm run dev:client           # esbuild --watch for the browser half
npm run format               # prettier --write across the repo
npm run format:check         # verify formatting; run before committing
npm run test:integration     # live Zotero at 127.0.0.1:23119; skipped unless ZOTERO_INTEGRATION=1
```

## Plugin form

The plugin is a class-form Cordis service: the loader mounts the default export (`ZoteroService`) with the row's validated config. `src/index.ts` stays a pure re-export entry.

- `ZoteroService extends Service` with `static inject = ['tools', 'systemPrompt']` and `static Config = ConfigSchema`; declaration merging exposes it as `ctx.zotero` ([plugin forms](../docs/user/develop/basic/index.md), [services](../docs/user/develop/framework/service.md)).
- The constructor installs the `zotero` settings section via `installSettingsSection` (composition entry as the base layer): `config` is a getter over a live source, and every committed section rebuilds the HTTP client and the `local` provider through `rebuild()`. Tools read `service.config` per request so validation limits follow edits. The namespace constant lives in `src/settings-namespace.ts`, shared with the browser half.
- One package owns all three capability roles: definition (`ZoteroService` + the `ZoteroProvider` interface in `src/types.ts`), provider (`LocalApiProvider`), consumers (`src/tools/`). Split only when roles must evolve independently ([three-role design](../docs/user/develop/practice/index.md)).
- Providers register through `registerProvider()` (effect-scoped; duplicate ids throw) and are selected by the `provider` config id. The service gates every domain call on the provider's declared `capabilities`; there is no cross-provider fallback.

## Registrations are effects

Everything registered in the constructor unwinds with the plugin fiber, so config edits and HMR replace the instance cleanly ([lifecycle](../docs/user/develop/framework/index.md)):

- Tools: `ctx.tools.register(defineTool(...))` from `@deepseek-ai/dsh-tools` ([tool tutorial](../docs/user/develop/basic/tool.md)).
- Prompt: `ctx.systemPrompt.section({ name, order, text })`.
- Command: `ctx.inject(['commands'], ...)` — the optional-dependency form keeps the plugin loadable in headless compositions without `commands`.
- Provider: `ctx.effect()`.
- Settings section: `installSettingsSection` (optional dependency — absent settings services leave the plugin on its entry config).
- Browser card: `src/client/` registers into the harness's `settings.section` slot with its own staged form (no cross-plugin value imports); built to `lib/client.js` by esbuild in the `__ModuleLoader__.load` handoff format.

## Conventions

- **Config**: `Config` interface plus a same-named Schemastery schema carrying defaults; `resolveConfig` enforces what the schema cannot express (loopback-only `baseUrl`, positive limits) and fails the load loudly. No hardcoded tunables ([configuration tutorial](../docs/user/develop/basic/config.md)).
- **Tools**: `parameters`/`output.schema` are the model contract. Enforce domain constraints beyond the schema in the `buildRequest`-style step by throwing `ZoteroError(ZOTERO_INVALID_ARGUMENT)`. `execute` returns plain lossless-JSON DTOs from `src/types.ts`; `render` is a pure function. Keep tool schemas in sync with those DTOs.
- **Errors**: throw `ZoteroError` with a stable code from `src/errors.ts`; messages are model-facing and never embed HTTP internals.

## Local launch & dev

Daily host-half loop (in-process HMR, non-default port):

```sh
npm run build          # once; also `pnpm run build` in the harness checkout once (source CLI)
npm run dev &          # host half: tsc --watch → lib/
dsh web --patch ./dev-lib.cordis.yml --port 3307   # 3080 is the live GUI — never reuse it
```

`dev-lib.cordis.yml` re-enables loader HMR (off in the production profile), disables the profile-installed row, and runs this checkout from `lib/`: src edits hot-swap in-process. Its `name`/`base` are absolute (the loader resolves relative names beside the profile dir) — adjust on a moved checkout. The overlay row is an absolute path, so it carries **no browser half** (that loads only for bare-package-name rows).

Full plugin — the only flow that loads the browser half (settings card + Zotero tab): link this checkout into a scratch profile, launch the source CLI. Seed the scratch home with **both** files: credentials carry the keys, `settings.yaml` carries custom providers (opencode-go under `llm-pi-ai.providers`) — skip the latter and the UI shows only default DeepSeek even though the credentials are complete:

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml "$DSH_HOME/"
chmod 600 "$DSH_HOME/.credentials.yaml" "$DSH_HOME/settings.yaml"
npm run build          # lib/client.js must exist before launch; link does not build it
dsh plugin --profile web link .    # pnpm peer-dependency warnings are expected
cd .. && pnpm dsh web --port 3307
```

Verify: `curl -w '%{http_code}' -o /dev/null http://127.0.0.1:3307` → 200; `"$DSH_HOME"/profiles/web/package.json` lists `dsh-zotero` as a link dependency; `grep -c conversation.view lib/client.js` ≥ 1. Reusing a configured home as `DSH_HOME` skips the seeding. Browser-half iteration: `npm run dev:client` (esbuild --watch) → page refresh; both home files hot-reload without a restart.

Host-only alternative (tsx loads `src/index.ts`, no browser half):
`cd .. && pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml --port <X>`.

## Credentials

The default home already has `~/.dsh/.credentials.yaml` — nothing to do. A scratch `DSH_HOME`: `cp ~/.dsh/.credentials.yaml "$DSH_HOME/"` (hot-reloaded, no restart). Custom providers live in `settings.yaml`, not the credentials store — a scratch home needs both (see Local launch & dev). One-off: `DEEPSEEK_API_KEY=... dsh web`. Precedence: launch env

> `$DSH_HOME/.credentials.yaml` > `<cwd>/.env` > `$DSH_HOME/.env`
> ([credentials-local](../packages/credentials/credentials-local/README.md)).
> Never print or commit the value (file mode `0600`).

## Bundle

`dsh.bundle.patch` points at `cordis.patch.yml`, which inserts one row: id `zotero`, name `dsh-zotero`, empty config. Keep the patch minimal — defaults belong in the Config schema ([bundle manifest](../docs/user/develop/basic/publish.md)).
