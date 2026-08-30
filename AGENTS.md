# AGENTS.md

## Workspace and source of truth

- You work in `.` This repo is a standalone sibling to `../deepseek-harness`. You keep it beside the harness for local dev. Treat this as temp local layout, hard-coded for your machine.
- You find the dsh source in `../deepseek-harness`. Read `../deepseek-harness/docs/AGENTS.md`, `../deepseek-harness/docs/architecture.md`, `../deepseek-harness/docs/user/develop/`, `../deepseek-harness/docs/subsystems/`, `../deepseek-harness/docs/cookbook/`, and `../deepseek-harness/packages/*/README.md` when you touch harness contracts.
- You touch slots, services, the web shell, the client-module graph, or Typert, so you check harness source first. Harness source outranks this file.

## Git commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, types lowercase (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `build`, `ci`, `revert`), subject in imperative mood, header under 72 chars. Optionally place an emoji matching the type right after the colon, before the subject. Body: blank line, bullet points only, each item wraps at 72, what and why.

## Commands

```sh
npm install                  # sibling at ../deepseek-harness; add --no-workspaces only for a nested copy
npm run typecheck            # tsc --noEmit for the node, test, and client projects
npm test                     # vitest unit tests against the mock Zotero server
npm run test:coverage        # coverage gate on src/ (97 stmts / 95 branches / 98 funcs / 97 lines); pure re-export and types-only modules excluded, see vitest.config.ts
npm run build                # tsc emits the node half into lib/; esbuild emits the browser half lib/client.js (with a loader-handoff self-check)
npm run build:client         # rebuild the browser half only
npm run dev                  # tsc --watch
npm run dev:client           # esbuild --watch for the browser half
npm run format               # prettier --write across the repo
npm run format:check         # verify formatting; run before committing
npm run test:integration     # live Zotero at 127.0.0.1:23119; skipped unless ZOTERO_INTEGRATION=1
```

## Plugin form

The loader mounts the default export (`ZoteroService`) with the row's validated config. `src/index.ts` stays a pure re-export entry.

- `ZoteroService extends Service` with `static inject = ['tools', 'systemPrompt']` and `static Config = ConfigSchema`. You declare it as `ctx.zotero` ([plugin forms](../deepseek-harness/docs/user/develop/basic/index.md), [services](../deepseek-harness/docs/user/develop/framework/service.md)).
- You install the `zotero` settings section in the constructor with `installSettingsSection` (composition entry as the base layer). The `config` getter reads a live source. Every committed section rebuilds the HTTP client and the `local` provider through `rebuild()`. Tools read `service.config` per request so validation limits follow edits. The namespace constant lives in `src/settings-namespace.ts` and you share it with the browser half.
- One package owns all three capability roles: definition (`ZoteroService` + the `ZoteroProvider` interface in `src/types.ts`), provider (`LocalApiProvider`), consumers (`src/tools/`). Split only when roles must evolve apart ([three-role design](../deepseek-harness/docs/user/develop/practice/index.md)).
- You register providers through `registerProvider()`. The call is effect-scoped. Duplicate ids throw. The service selects a provider by the `provider` config id and gates every domain call on its declared `capabilities`. No fallback across providers.

## Registrations are effects

You register everything in the constructor. The fiber unwinds it when you edit config or when HMR replaces the instance ([lifecycle](../deepseek-harness/docs/user/develop/framework/index.md)):

- Tools: you call `ctx.tools.register(defineTool(...))` from `@deepseek-ai/dsh-tools` ([tool tutorial](../deepseek-harness/docs/user/develop/basic/tool.md)).
- Prompt: you call `ctx.systemPrompt.section({ name, order, text })`.
- Command: you call `ctx.inject(['commands'], ...)`. The optional-dependency form keeps the plugin loadable in headless compositions without `commands`.
- Provider: you call `ctx.effect()`.
- Settings section: you call `installSettingsSection` (optional dependency, absent settings services leave the plugin on its entry config).
- Browser surface (`src/client/`, esbuild emits `lib/client.js` in `__ModuleLoader__.load` handoff format): you ship one configuration card over the `zotero` namespace. You read and write through the harness `settingsScope` binder. You do not import values across plugins. The card registers into the keyed `settings.plugin.item` slot under the namespace key. The Plugins config tab dispatches it. You render the staged form in the section's native disclosure chrome. You mirror `PluginCard` tokens, you do not value-import `PluginCard`. The Typert Remote namespace carries only the `zotero/status` connectivity probe for the conversation tab. The tab reads `webEnabled` live. You subscribe it to the same scope and it shows or hides as the flag changes.

## Conventions

- **Config**: you define `Config` interface plus a same-named Schemastery schema with defaults. You call `resolveConfig` to enforce what the schema cannot express (loopback-only `baseUrl`, positive limits). The call fails the load loud. You keep no hard-coded tunables ([configuration tutorial](../deepseek-harness/docs/user/develop/basic/config.md)).
- **Tools**: you treat `parameters`/`output.schema` as the model contract. You enforce domain constraints beyond the schema in the `buildRequest` step. Throw `ZoteroError(ZOTERO_INVALID_ARGUMENT)` there. `execute` returns plain lossless-JSON DTOs from `src/types.ts`. `render` stays pure. Keep tool schemas in sync with those DTOs.
- **Errors**: you throw `ZoteroError` with a stable code from `src/errors.ts`. Messages target the model. You never embed HTTP internals.

## Local launch & dev

You have two dev servers. Pick one based on what you test:

- **Full plugin**: this is the only flow that loads the browser half (settings card + Zotero tab). Use it for UI work and end-to-end plugin tests.
- **Host half only (HMR)**: you get tools and `/zotero` status with in-process hot reload. The plugin UI never loads here.

### Full plugin (settings card + Zotero tab)

You need both files in a scratch home. Credentials carry keys, `settings.yaml` carries custom providers (opencode-go under `llm-pi-ai.providers`). If you skip the latter, the UI shows only default DeepSeek though credentials are complete. Link this checkout into the web profile (bare package name, so the browser half loads), run both watchers, then launch the source CLI with `env DSH_HOME`. If you run `pnpm dsh web` without `env`, it ignores a sourced `DSH_HOME` and boots the real `~/.dsh` (the npm-installed row, not this checkout). The plugin then looks missing because you inspect the wrong home:

```sh
export DSH_HOME=$(mktemp -d /tmp/dsh-zotero-dev-XXXX)
cp ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml "$DSH_HOME/"
chmod 600 "$DSH_HOME/.credentials.yaml" "$DSH_HOME/settings.yaml"
npm run build          # lib/client.js must exist before launch; link does not build it
dsh plugin --profile web link .    # pnpm peer-dependency warnings are expected
npm run dev &          # host half: tsc --watch → lib/
npm run dev:client &   # browser half: esbuild --watch → lib/client.js
cd ../deepseek-harness && env DSH_HOME="$DSH_HOME" node --import tsx/esm apps/cli/src/bin.ts web --port 3307
# 3080 is the live GUI, never reuse it
```

One-shot check (all four must pass):

```sh
curl -w '%{http_code}' -o /dev/null http://127.0.0.1:3307        # 200
ps eww $(lsof -ti :3307) | grep -o 'DSH_HOME=[^ ]*'              # the scratch home
grep dsh-zotero "$DSH_HOME"/profiles/web/package.json            # link: dependency
grep -c conversation.view lib/client.js                          # ≥ 1
```

You edit `src/client`, esbuild watch rebuilds, you refresh the page. The browser half has no HMR. You edit the host half, tsc watch rebuilds `lib/`, you restart dsh to apply. Both home files hot-reload without restart. You can reuse a configured home as `DSH_HOME` and skip seeding and link. Remember `/tmp` wipes on reboot.

### Host half only (in-process HMR)

```sh
npm run build          # once; also `pnpm run build` in ../deepseek-harness once (source CLI)
npm run dev &          # host half: tsc --watch → lib/
cp dev-lib.cordis.yml.example dev-lib.cordis.yml   # then set absolute paths inside (see file header)
dsh web --patch ./dev-lib.cordis.yml --port 3307   # 3080 is the live GUI, never reuse it
```

`dev-lib.cordis.yml` re-enables loader HMR (off in the production profile), disables the profile-installed row, and runs this checkout from `lib/`. You get hot-swap without restarting dsh when you rebuild. Its `name`/`base` are absolute. The loader resolves relative names beside the profile dir, so you must set them explicit. The file is gitignored, regenerate it from `dev-lib.cordis.yml.example` and replace the `<absolute-path-to-dsh-zotero>` placeholders. The overlay row is an absolute path, so it carries no browser half. That loads only for bare-package-name rows. No settings card and no Zotero tab there, use the full-plugin flow for UI work.

Host-only alternative (tsx loads `src/index.ts`, no browser half): copy `dev.cordis.yml.example` to `dev.cordis.yml` (set `<absolute-path-to-dsh-zotero>` inside), then run `cd ../deepseek-harness && pnpm dsh web --patch ../dsh-zotero/dev.cordis.yml --port <X>`.

The DSH packages you launch above come from the sibling pnpm workspace at `../deepseek-harness` (`0.1.2-alpha.1`). Typecheck, tests, and build run against the same `0.1.2-alpha.1` versions in `node_modules` (devDependencies pin it exactly), no skew. If the sibling moves ahead, run `npm install` to re-align.

## Credentials

The default home already has `~/.dsh/.credentials.yaml`, you do nothing. For a scratch `DSH_HOME`, run `cp ~/.dsh/.credentials.yaml "$DSH_HOME/"` (hot-reloaded, no restart). Custom providers live in `settings.yaml`, not the credentials store, so a scratch home needs both (see Local launch & dev). One-off: `DEEPSEEK_API_KEY=... dsh web`. Precedence: launch env

> `$DSH_HOME/.credentials.yaml` > `<cwd>/.env` > `$DSH_HOME/.env`
> ([credentials-local](../deepseek-harness/packages/credentials/credentials-local/README.md)).
> Never print or commit the value (file mode `0600`).

## Bundle

`dsh.bundle.patch` points at `cordis.patch.yml`, which inserts one row: id `zotero`, name `dsh-zotero`, empty config. Keep the patch small. Defaults belong in the Config schema ([bundle manifest](../deepseek-harness/docs/user/develop/basic/publish.md)).

## Release & upstream checklist

Work through every item when you align with a new deepseek-harness version or cut a release:

- `package.json` `dshWorkshop.compatibility.dshVersions`: add the harness version the artifact was verified against. This is the DSH Hub Workshop intake manifest (introduced in v0.4.1); the published npm tarball carries it, and a stale pin misreports compatibility to the hub.
- `src/client/index.ts` resolves the mounted namespace via `ctx.reflect.get('remote.zotero')` instead of a dotted `ctx.remote.zotero` read: the generated-style walk stops at the Loader's runtime-less internal forks between a plugin entry and the root fiber. This is deliberate (see the in-place comment) and is the first thing to re-check on any harness upgrade — if upstream provides an official face read, replace the workaround. Re-verified at 0.1.2-alpha.1: the vendored cordis and the gateway's `remote.<namespace>` mount mechanism are unchanged, so the workaround stays.
- `scripts/build-client.mjs` marks `@deepseek-ai/dsh-client-ui-primitives`, `react`, and `react/jsx-runtime` as external, and `package.json` `dsh.client.inject` names seven client packages (locale, ui-settings, ui-settings-plugins, ui-slots, ui-conversation, ui-session, ui-chat). The snapshot-store library (`@deepseek-ai/dsh-client-store`) is a plain library with no module-table row, so it bundles into `lib/client.js` together with its immer/zustand deps. When upstream reshapes its client package boundaries, verify both lists together; `npm run build`'s sandbox self-check (`verifyBundle`) catches a broken handoff.
- `src/client/components/SourcesTab.tsx` reads the tab's call blocks exclusively through `useChat((s) => s.legacy)` — the harness labels that slice a compatibility projection (the modern read is `ChatSnapshot.nodes`/`locations`). This is the client-half seam to re-check on any harness upgrade: if upstream retires `.legacy`, migrate the two pure collectors in that file onto the new projection, nothing else consumes it.
- `discovery-smoke.mjs` rides the alpha.1 web-auth seam: it exchanges the boot token printed by `dsh web` for the page cookie and carries that cookie on every probe, and it accepts both boot-global spellings (`window.__DSH_BOOT__`, `globalThis["__DSH_BOOT__"]`). Re-check both on a harness upgrade that touches webserver auth or the boot injection.
- `docs/tools.md` states the pagination policy (array listings require a valid `Total-Results` header and fail loud; the `zotero_changes` `format=versions` diffs instead fall back to the page-full EOF heuristic because local-API builds omit the header there). Keep both halves true if you touch `src/local/pagination.ts` or `src/local/changes-domain.ts`.
