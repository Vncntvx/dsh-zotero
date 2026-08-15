# AGENTS.md

## Git commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, types lowercase (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `build`, `ci`, `revert`), subject in imperative mood, header under 72 chars. Optionally place an emoji matching the type right after the colon, before the subject. Body: blank line, bullet points only, each item wraps at 72, what and why.

## Commands

```sh
npm install
npm run typecheck        # tsc --noEmit for the src and test projects
npm test                 # vitest unit tests against the mock Zotero server
npm run test:coverage    # 100% coverage gate on src/; src/index.ts and src/types.ts excluded (pure re-export / types-only)
npm run build            # tsc emits lib/
npm run dev              # tsc --watch
npm run test:integration # live Zotero at 127.0.0.1:23119; skipped unless ZOTERO_INTEGRATION=1
```

## Plugin form

The plugin is a class-form Cordis service: the loader mounts the default export (`ZoteroService`) with the row's validated config. `src/index.ts` stays a pure re-export entry.

- `ZoteroService extends Service` with `static inject = ['tools', 'systemPrompt']` and `static Config = ConfigSchema`; declaration merging exposes it as `ctx.zotero` ([plugin forms](../docs/user/develop/basic/index.md), [services](../docs/user/develop/framework/service.md)).
- One package owns all three capability roles: definition (`ZoteroService` + the `ZoteroProvider` interface in `src/types.ts`), provider (`LocalApiProvider`), consumers (`src/tools/`). Split only when roles must evolve independently ([three-role design](../docs/user/develop/practice/index.md)).
- Providers register through `registerProvider()` (effect-scoped; duplicate ids throw) and are selected by the `provider` config id. The service gates every domain call on the provider's declared `capabilities`; there is no cross-provider fallback.

## Registrations are effects

Everything registered in the constructor unwinds with the plugin fiber, so config edits and HMR replace the instance cleanly ([lifecycle](../docs/user/develop/framework/index.md)):

- Tools: `ctx.tools.register(defineTool(...))` from `@deepseek-ai/dsh-tools` ([tool tutorial](../docs/user/develop/basic/tool.md)).
- Prompt: `ctx.systemPrompt.section({ name, order, text })`.
- Command: `ctx.inject(['commands'], ...)` — the optional-dependency form keeps the plugin loadable in headless compositions without `commands`.
- Provider: `ctx.effect()`.

## Conventions

- **Config**: `Config` interface plus a same-named Schemastery schema carrying defaults; `resolveConfig` enforces what the schema cannot express (loopback-only `baseUrl`, positive limits) and fails the load loudly. No hardcoded tunables ([configuration tutorial](../docs/user/develop/basic/config.md)).
- **Tools**: `parameters`/`output.schema` are the model contract. Enforce domain constraints beyond the schema in the `buildRequest`-style step by throwing `ZoteroError(ZOTERO_INVALID_ARGUMENT)`. `execute` returns plain lossless-JSON DTOs from `src/types.ts`; `render` is a pure function. Keep tool schemas in sync with those DTOs.
- **Errors**: throw `ZoteroError` with a stable code from `src/errors.ts`; messages are model-facing and never embed HTTP internals.

## Dev overlays

- From a dsh source checkout: `pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml` — loads `src/index.ts` through tsx; keep the absolute path current.
- Against an installed dsh: `npm run dev` then `dsh web --patch ./dev-lib.cordis.yml --port 3307` — HMR over the built `lib/`.

## Bundle

`dsh.bundle.patch` points at `cordis.patch.yml`, which inserts one row: id `zotero`, name `dsh-zotero`, empty config. Keep the patch minimal — defaults belong in the Config schema ([bundle manifest](../docs/user/develop/basic/publish.md)).
