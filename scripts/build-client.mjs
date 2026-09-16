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
 * After the build, the artifact is evaluated with a stub module loader to
 * prove the handoff contract: the factory must register and export the
 * browser plugin face (`apply`/`inject`). Pass `--watch` to rebuild on
 * change (the dev overlay's HMR picks the file up).
 * @module dsh-zotero/scripts/build-client
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as esbuild from 'esbuild'
import { transform as transformCss } from 'lightningcss'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Plugin id stamped into the loader handoff; must equal the npm package name. */
const PLUGIN_ID = 'dsh-zotero'

/** The package version the bundle carries; `unknown` on an unreadable manifest. */
function buildVersionOf() {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version
  } catch {
    // Fall through: a missing manifest must not fail the build.
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
 *  build when a harness module slips into the artifact. At dsh 0.1.6-alpha.1
 *  PLATFORM_MODULES also lists react-dom, @deepseek-ai/cordis, ui-slots, and
 *  ui-dockkit — this bundle value-imports none of them today (cordis and
 *  ui-slots are type-only), so they stay out of EXTERNALS and the purity
 *  gate trips if a later value import needs them moved in. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Harness specifiers a client bundle may **inline**, mirroring the harness's own
 * bundle-purity rule (`packages/client/tsdown.client.ts` `INLINE_SAFE` +
 * `GENERATED_REMOTE` + `VENDORED_LIBRARY`): contract layers and pure folds with
 * no runtime identity to share — no singleton, no Symbol/instanceof identity —
 * plus generated `.../remote` contributions and the two vendored libraries.
 * Everything else under `@deepseek-ai/` is either a module-table entry
 * (external) or a leak. Keep this in step with that rule.
 */
const INLINABLE_HARNESS_SPECIFIER =
  /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-agent-presets\/display$|@deepseek-ai\/dsh-spill-policy\/notice$|@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$|@deepseek-ai\/(?:cosmokit|schemastery)(?:\/|$))/

/** Fails the build when a harness module reaches the artifact that may not be
 *  inlined: a second copy of a shell singleton (`ctx`, the store, the UI
 *  primitives) carries no loader identity, so it would silently split state
 *  across two instances. Reads the specifiers the graph actually resolves — the
 *  same unit the harness's own rule is written in — so a symlinked sibling
 *  checkout and a registry install are policed identically. */
const bundlePurityPlugin = {
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
        (specifier) =>
          !EXTERNALS.includes(specifier) && !INLINABLE_HARNESS_SPECIFIER.test(specifier),
      )
      if (offenders.length > 0) {
        throw new Error(
          `client bundle reached harness modules it may neither externalize nor inline: ${offenders.join(', ')}` +
            ' — add the package to EXTERNALS when the loader table serves it' +
            ' (harness packages/client/web/src/platform.ts PLATFORM_MODULES),' +
            ' or leave it type-only',
        )
      }
    })
  },
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
      const id = `dsh-zotero/${basename(args.path)}`
      const style = code
        .toString('utf8')
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('${', '\\${')
      const contents = [
        'const style = `' + style + '`;',
        `if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="${id}"]')) {`,
        "  const tag = document.createElement('style');",
        `  tag.setAttribute('data-plugin-css', ${JSON.stringify(id)});`,
        '  tag.textContent = style;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(names)};`,
      ].join('\n')
      return { contents, loader: 'js' }
    })
  },
}

const options = {
  entryPoints: [join(root, 'src/client/index.ts')],
  plugins: [bundlePurityPlugin, cssModulesPlugin],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // The loader's module table answers react/jsx-runtime, so the automatic
  // runtime keeps JSX out of the bundle and avoids a classic-runtime React
  // global (dsh-at-file's build uses the same mode).
  jsx: 'automatic',
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

/** Prove the emitted bundle satisfies the loader handoff contract. */
function verifyBundle() {
  const source = readFileSync(options.outfile, 'utf8')
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
  // runs; stubbing those and refusing everything else proves the bundle's
  // only runtime dependencies are the platform modules the table answers.
  const exported = handoff.factory((specifier) => {
    if (EXTERNALS.includes(specifier)) return {}
    throw new Error(`bundle required non-external ${specifier} at load time`)
  })
  if (typeof exported?.apply !== 'function' || !Array.isArray(exported?.inject)) {
    throw new Error('client bundle must export the apply/inject plugin face')
  }
  console.log(
    `client bundle ok: lib/client.js (${source.length} bytes, ${EXTERNALS.join(', ')} external)`,
  )
}

/**
 * Build the browser client bundle, once or in watch mode.
 *
 * Exported so `scripts/build-prepare.mjs` (the source-install build) can emit
 * the same artifact without duplicating this configuration; running this file
 * directly keeps the one-shot/watch CLI behaviour.
 * @param options - `watch` keeps the esbuild context alive and rebuilds on change.
 * @returns resolves after the one-shot build and its self-check, or once the watch session starts.
 */
export async function buildClientBundle({ watch = false } = {}) {
  if (watch) {
    const context = await esbuild.context(options)
    await context.watch()
    console.log('watching src/client for changes…')
    return
  }
  await esbuild.build(options)
  verifyBundle()
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildClientBundle({ watch: process.argv.includes('--watch') })
}
