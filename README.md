# dsh-zotero

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) external plugin for Zotero integration.

## Status

Initial skeleton. No functionality implemented yet.

## Project layout

```
dsh-zotero/
├── package.json        # npm package + dsh.bundle manifest
├── tsconfig.json
├── src/index.ts        # plugin entry: name / apply
├── cordis.patch.yml    # bundle patch used when installed via dsh plugin add
├── dev.cordis.yml      # local dev overlay for --patch
└── README.md
```

## Local development

From a DeepSeek Harness source checkout, build once:

```sh
pnpm install
pnpm run build
```

Then start the Web UI with the local overlay:

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

> Note: `dev.cordis.yml` uses an absolute path to `src/index.ts` because local `--patch` overlays require absolute plugin paths. Adjust it if your checkout is elsewhere.

You should see `[dsh-zotero] plugin loaded` in the terminal.

## Install as a bundle

Build the package:

```sh
npm install
npm run build
```

Install it into a dsh profile:

```sh
dsh plugin --profile demo add ./dsh-zotero
```

Or publish it and install by package name:

```sh
dsh plugin --profile demo add dsh-zotero
```

## Next steps

- Add tools with `ctx.tools.register(...)`
- Add configuration via `Config` + Schemastery schema
- If you want UI in `dsh web`, add a client half (`dsh.client` + `ctx.slots.register`)
