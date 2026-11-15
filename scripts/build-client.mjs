/**
 * Build the browser client bundle with esbuild.
 *
 * Emits `lib/client.js` in the harness's loader-handoff format: the bundle is
 * a CJS closure registered through `window.__ModuleLoader__.load({ id,
 * factory })`, with platform modules (react, the harness UI primitives)
 * resolved at runtime by the loader's module-table require instead of being
 * inlined. This mirrors what the harness's tsdown preset produces for its own
 * client packages; esbuild keeps the third-party toolchain to one dependency.
 *
 * The client graph is policed by **runtime authority**, not by post-hoc string
 * matching on the artifact:
 *
 * 1. Platform modules stay external (`EXTERNALS` + loader-handoff stub).
 * 2. Harness packages may only externalize or inline what the harness's own
 *    purity rule allows (`bundlePurityPlugin`).
 * 3. This package's local sources may only enter the client graph when they
 *    are client-safe (`CLIENT_SAFE_LOCAL` in
 *    `scripts/client-graph-authority.mjs`, that regex is the sole authority;
 *    currently `src/client/**` plus the shared pure surfaces `contract`,
 *    `settings-namespace`, `json`, `ref-grammar`, `export-items`,
 *    `changes-contract`, `browse-rows`, and `evidence-item`).
 * 4. Host-only packages (`@deepseek-ai/schemastery`) are refused at resolve time;
 *    `zod` is externalized as a shared platform module.
 *
 * Gates 3–4 are re-checked against esbuild's metafile on every successful
 * build (one-shot and watch), so minify settings and path comments cannot
 * hide a host-owned module. The loader-handoff self-check runs on the same
 * `onEnd` path.
 *
 * Pass `--watch` to rebuild on change (the dev overlay's HMR picks the file
 * up); authority and handoff gates still run on every rebuild.
 * @module dsh-zotero/scripts/build-client
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as esbuild from 'esbuild'
import { transform as transformCss } from 'lightningcss'
import { createClientAuthorityPlugin, isInlineSafeHarness } from './client-graph-authority.mjs'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// The package manifest is read once; the handoff id and the stamped version
// are faces of it, so they cannot drift from `package.json` independently.
const PLUGIN_MANIFEST = (() => {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error(
      `client build cannot read package.json: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
})()

/**
 * Plugin id stamped into the loader handoff. Derived from the npm package
 * name: the loader resolves the bundle by this id, so a rename here and a
 * rename in `package.json` are one edit, not two.
 */
const PLUGIN_ID = PLUGIN_MANIFEST.name

/**
 * The client bundle's byte ceiling: the whole browser half ships as one file
 * the host loads on every boot, so its growth is a real startup and install
 * cost. The current bundle sits near 656 KB; the ceiling allows ~10% of
 * headroom before a release fails, which turns an accidental dependency
 * balloon (an inlined library, a duplicated copy) into a build error instead
 * of a quiet regression. Raise it deliberately with a measured reason.
 */
export const MAX_CLIENT_BUNDLE_BYTES = 704 * 1024

/** The package version the bundle carries; `unknown` on an unreadable value. */
function buildVersionOf() {
  if (typeof PLUGIN_MANIFEST.version === 'string' && PLUGIN_MANIFEST.version !== '') {
    return PLUGIN_MANIFEST.version
  }
  return 'unknown'
}

/**
 * The commit short-id the bundle carries: an explicit env value (a local
 * `DSH_ZOTERO_COMMIT` override or CI's `GITHUB_SHA`) beats git; a git
 * failure degrades to `unknown` instead of failing the build.
 */
function buildCommitOf() {
  for (const name of ['DSH_ZOTERO_COMMIT', 'GITHUB_SHA']) {
    const value = process.env[name]
    if (value !== undefined && /^[A-Za-z0-9]{4,64}$/.test(value)) return value.slice(0, 7)
  }
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (/^[A-Za-z0-9]{4,64}$/.test(head)) return head
  } catch {
    // Fall through: no git (a tarball checkout) must not fail the build.
  }
  return 'unknown'
}

/** Platform modules the loader's module table answers; never bundled. The
 *  snapshot-store library (`@deepseek-ai/dsh-client-store`) shares the shell
 *  singleton via the module table (harness `packages/client/web/src/platform.ts`
 *  `PLATFORM_MODULES` + `seed.ts:getStaticModules`), so it stays external
 *  alongside react and the UI primitives instead of bundling zustand/immer.
 *  That harness list is this one's counterpart: anything in it that this bundle
 *  value-imports belongs here too, and `bundlePurityPlugin` below fails the
 *  build when a harness module slips into the artifact.
 *
 *  No PLATFORM_MODULES member can be silently inlined: `@deepseek-ai/cordis`,
 *  `ui-slots`, and `ui-dockkit` match the purity plugin's `@deepseek-ai/*`
 *  filter; `react-dom` is external because the tag filter's portal is a real
 *  value import (`createPortal`); and `@tanstack/react-virtual` (new on the
 *  platform table in dsh 0.2.1-alpha.4) is refused by the graph-authority
 *  metafile check until a real value import externalizes it here. Every
 *  external above resolves through the shell's one copy instead of a second
 *  copy bundled into the artifact. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'zod',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@tanstack/react-virtual',
]

/**
 * Harness inline-safety lives in `client-graph-authority.mjs`
 * (`INLINE_SAFE` / `GENERATED_REMOTE` / `VENDORED_LIBRARY`), the counterpart of
 * `packages/client/tsdown.client.ts` at the harness pin tag. The three patterns
 * are a verbatim copy of that file's constants: after a harness bump, extract
 * them from the new tag (`git show dsh-v<pin>:…`) and mirror the change here
 * rather than editing from memory or from the sibling's working tree. Packages
 * the host half owns also live there: resolve-time and metafile enforcement
 * share one rule source with the unit tests.
 */

/** Metafile artifact markers that mean host schema materialization leaked in. */
const HOST_SCHEMA_ARTIFACT_MARKERS = [/\bnode_modules\/zod\b/, /\bnode_modules\/schemastery\b/]

/** Fails the build when a harness module reaches the artifact that may not be
 *  inlined: a second copy of a shell singleton (`ctx`, the store, the UI
 *  primitives) carries no loader identity, so it would silently split state
 *  across two instances. Reads the specifiers the graph actually resolves (the
 *  same unit the harness's own rule is written in), so a symlinked sibling
 *  checkout and a registry install are policed identically. */
const harnessPurityPlugin = {
  name: 'harness-bundle-purity',
  setup(build) {
    const harnessSpecifiers = new Set()
    // Watch mode reuses one esbuild context; reset per build so a violation
    // fixed in a later rebuild stops failing the gate instead of lingering.
    build.onStart(() => {
      harnessSpecifiers.clear()
    })
    build.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
      harnessSpecifiers.add(args.path)
      // Undefined defers to esbuild's own resolution, which applies `external`.
      return undefined
    })
    build.onEnd((result) => {
      if (result.errors.length > 0) return
      const offenders = [...harnessSpecifiers].filter(
        (specifier) => !EXTERNALS.includes(specifier) && !isInlineSafeHarness(specifier),
      )
      if (offenders.length > 0) {
        return {
          errors: [
            {
              text:
                `client bundle reached harness modules it may neither externalize nor inline: ${offenders.join(', ')}` +
                ' — add the package to EXTERNALS when the loader table serves it' +
                ' (harness packages/client/web/src/platform.ts PLATFORM_MODULES),' +
                ' or leave it type-only',
            },
          ],
        }
      }
      return undefined
    })
  },
}

/**
 * Static platform modules this verification seeds into the loader's table.
 * The react family resolves to real modules because evaluating the bundle's
 * class components (the error boundaries) requires a real `React.Component`;
 * every `@deepseek-ai/*` external returns an empty stub. That is deliberately
 * narrower than the harness shell's own seed table, which answers harness
 * modules too: this local gate only needs class-component evaluability, and
 * the stub keeps the bundle's harness wiring out of the verified surface.
 * @returns mapping of external specifier to module entity.
 */
function platformModuleTable() {
  const table = {}
  for (const specifier of EXTERNALS) {
    if (!specifier.startsWith('@deepseek-ai/')) table[specifier] = require(specifier)
  }
  return table
}

/**
 * The module-loader API this bundle targets.
 *
 * The browser loader is a shell global, not an installed package: nothing in
 * this repository can ask it which handoff shape it accepts. Upstream HEAD
 * moves to `load({ id, factory, meta: () => ({ stylesheets }) })` and drops the
 * `data-plugin-css` tag handling this bundle relies on; that change is not in
 * the pinned release yet. So the API is a deliberate constant that
 * `npm run harness:pin` must revisit (DN-10), and the build refuses the two
 * halves drifting apart in either direction.
 */
export const CLIENT_LOADER_API = 'legacy-stylesheet-tag'

/** The marker the legacy handoff injects; the meta API replaces it. */
export const LEGACY_STYLESHEET_MARKER = 'data-plugin-css'

/**
 * Refuse a bundle built for the other loader API.
 *
 * A bundle still injecting the legacy tag against a loader that no longer
 * handles it leaves the styles unretained after a disable; the meta shape
 * against the pinned loader registers a handoff the shell ignores. Either mix
 * is silent at runtime, so it fails the build instead.
 * @param api - the constant above.
 * @param source - the produced bundle.
 * @returns void; throws when the two disagree.
 */
export function assertLoaderApi(api, source) {
  const legacy = source.includes(LEGACY_STYLESHEET_MARKER)
  if (api === 'meta-stylesheets' && legacy) {
    throw new Error(
      `client bundle still injects a ${LEGACY_STYLESHEET_MARKER} tag — ` +
        'CLIENT_LOADER_API names the meta-stylesheets handoff, so the CSS injection must move into ' +
        'load({ meta: () => ({ stylesheets }) }) in the same change (DN-10)',
    )
  }
  if (api === 'legacy-stylesheet-tag' && !legacy) {
    throw new Error(
      `client bundle no longer injects a ${LEGACY_STYLESHEET_MARKER} tag but CLIENT_LOADER_API still ` +
        'names the legacy handoff — flip the constant (and migrate the CSS injection) together',
    )
  }
}

/**
 * Artifact + handoff verification. Runs on every successful build (including
 * watch) through the verify plugin below.
 * @returns void; throws on a failed handoff or host-schema artifact marker.
 */
export function verifyBundle(bundlePath = join(root, 'lib/client.js')) {
  const source = readFileSync(bundlePath, 'utf8')
  // The loader-API pairing comes before any evaluation: a handoff the shell
  // cannot read is not worth executing.
  assertLoaderApi(CLIENT_LOADER_API, source)
  // The byte ceiling comes first: an oversize bundle fails the build before
  // any evaluation, so a size regression is reported as a size regression.
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes > MAX_CLIENT_BUNDLE_BYTES) {
    throw new Error(
      `client bundle is ${bytes} bytes, over the ${MAX_CLIENT_BUNDLE_BYTES}-byte ceiling — ` +
        'a new runtime dependency or a duplicated module likely grew it; ' +
        'keep host-only code out of the browser graph or raise the ceiling with a measured reason',
    )
  }
  let handoff
  const window = {
    __ModuleLoader__: {
      load: (value) => {
        handoff = value
      },
    },
  }
  vm.runInNewContext(source, { window })
  if (handoff === undefined || handoff.id !== PLUGIN_ID) {
    throw new Error(`client bundle did not register the ${PLUGIN_ID} factory`)
  }
  if (typeof handoff.factory !== 'function') {
    throw new Error('client bundle factory is not a function')
  }
  // The factory requires its externals from the loader's module table when it
  // runs; answering those with the shell's own seed entities and refusing
  // everything else proves the bundle's only runtime dependencies are the
  // platform modules the table answers.
  const platform = platformModuleTable()
  const exported = handoff.factory((specifier) => {
    if (EXTERNALS.includes(specifier)) return platform[specifier] ?? {}
    throw new Error(`bundle required non-external ${specifier} at load time`)
  })
  if (typeof exported?.apply !== 'function' || !Array.isArray(exported?.inject)) {
    throw new Error('client bundle must export the apply/inject plugin face')
  }
  // Secondary artifact markers: the graph allowlist is the primary authority;
  // this catches host-schema runtime text that somehow shipped without a
  // graph-visible module edge (e.g. pasted zod code under src/client).
  for (const marker of HOST_SCHEMA_ARTIFACT_MARKERS) {
    if (marker.test(source)) {
      throw new Error(
        `client bundle carries host-schema marker ${String(marker)} — ` +
          'an inlined zod or schemastery copy would split schema identity ' +
          'from the host; keep zod external (EXTERNALS / PLATFORM_MODULES) and ' +
          'host schema factories in src/status-codec.ts',
      )
    }
  }
  console.log(
    `client bundle ok: ${bundlePath} (${source.length} bytes, ${EXTERNALS.join(', ')} external)`,
  )
}

/** Inline `.module.css` files as scoped style injections (mirrors the harness
 *  tsdown preset's CSS handling; the loader executes the bundle as a classic
 *  script, so each module injects its own style tag with a per-module id). */
const cssModulesPlugin = {
  name: 'css-modules',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      const { code, exports: classMap } = transformCss({
        filename: args.path,
        code: Buffer.from(source),
        cssModules: true,
        minify: true,
      })
      const names = {}
      for (const [original, info] of Object.entries(classMap)) names[original] = info.name
      // Path-relative id: basename alone collides when two directories
      // ship the same module filename (e.g. `fields.module.css`).
      const id = `${PLUGIN_ID}/${relative(root, args.path).split('\\').join('/')}`
      const style = code
        .toString('utf8')
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('${', '\\${')
      const contents = [
        'const style = `' + style + '`;',
        `if (typeof document !== 'undefined') {`,
        //  Repaint an existing tag because the content-hashed class names may
        //  have changed between bundle executions.
        `  const tag = document.querySelector('style[data-plugin-css="${id}"]');`,
        `  if (tag !== null) tag.textContent = style;`,
        `  else {`,
        `    const fresh = document.createElement('style');`,
        `    fresh.setAttribute('data-plugin-css', ${JSON.stringify(id)});`,
        `    fresh.textContent = style;`,
        `    document.head.appendChild(fresh);`,
        `  }`,
        `}`,
        `export default ${JSON.stringify(names)};`,
      ].join('\n')
      return { contents, loader: 'js' }
    })
  },
}

/** Runs handoff verification on every successful build, including watch. */
const artifactVerifyPlugin = {
  name: 'client-artifact-verify',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return
      try {
        verifyBundle()
      } catch (error) {
        return {
          errors: [{ text: error instanceof Error ? error.message : String(error) }],
        }
      }
      return undefined
    })
  },
}

/**
 * The esbuild plugin list the client graph always carries. Exported so tests
 * can drive the same authority rules against fixture graphs; `verify: false`
 * drops the artifact-verify plugin, whose default bundle path is the real
 * `lib/client.js` a fixture build must not be validated against.
 * @returns harness purity + client authority + CSS modules (+ artifact verify
 * unless `verify: false`).
 */
export function clientBuildPlugins({ verify = true } = {}) {
  return [
    harnessPurityPlugin,
    createClientAuthorityPlugin(),
    cssModulesPlugin,
    ...(verify ? [artifactVerifyPlugin] : []),
  ]
}

/** Metafile inputs are required for the local-source allowlist re-check. */
const options = {
  entryPoints: [join(root, 'src/client/index.ts')],
  plugins: clientBuildPlugins(),
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  metafile: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // The loader's module table answers react/jsx-runtime, so the automatic
  // runtime keeps JSX out of the bundle and avoids a classic-runtime React
  // global (dsh-at-file's build uses the same mode).
  jsx: 'automatic',
  // The page loads this file as a classic script on every session start, so
  // its parse cost is on the critical path. Minification is safe here: the
  // module table answers `require`, nothing reads function names, and the
  // sourcemap still names every frame in a stack trace.
  minify: true,
  sourcemap: true,
  external: EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    // The external snapshot store's dependencies (zustand/immer) probe the
    // bundler mode exactly the way the harness tsdown preset substitutes
    // them: the bare `import.meta.env` truthiness probe AND the MODE key.
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    __DSH_ZOTERO_VERSION__: JSON.stringify(buildVersionOf()),
    __DSH_ZOTERO_COMMIT__: JSON.stringify(buildCommitOf()),
  },
  // The loader executes the bundle as a classic script; the handoff is the
  // only global side effect, and the factory returns the CJS exports. The
  // module/exports pair is established inside the factory closure, before
  // esbuild's own CJS output assigns to it.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
}

/**
 * Build the browser client bundle, once or in watch mode.
 *
 * Exported so `scripts/build-prepare.mjs` (the source-install build) can emit
 * the same artifact without duplicating this configuration; running this file
 * directly keeps the one-shot/watch CLI behaviour. Authority and handoff
 * gates run on every successful rebuild through `artifactVerifyPlugin`.
 * @param watch - `true` keeps the esbuild context alive.
 * @returns resolves after the one-shot build, or once the watch session starts.
 */
export async function buildClientBundle({ watch = false } = {}) {
  if (watch) {
    const context = await esbuild.context(options)
    await context.watch()
    console.log('watching src/client for client-graph authority + handoff gates…')
    return
  }
  await esbuild.build(options)
  // artifactVerifyPlugin already ran verifyBundle; a second call is intentional
  // only if the plugin was bypassed: keep the one-shot path honest by not
  // double-printing success. The plugin is the single verify path.
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildClientBundle({ watch: process.argv.includes('--watch') })
}
