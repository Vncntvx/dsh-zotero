/// <reference path="./vendor-types.d.ts" />
/**
 * Build the browser client bundle with esbuild.
 *
 * Emits `lib/client.js` in the harness's loader-handoff format: the bundle is
 * a CJS closure registered through `window.__ModuleLoader__.load({ id,
 * factory, meta })`, with platform modules (react, the harness UI primitives)
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import * as esbuild from 'esbuild'
import { transform as transformCss } from 'lightningcss'
import {
  createClientAuthorityPlugin,
  isInlineSafeHarness,
  CLIENT_EXTERNALS as EXTERNALS,
} from './client-graph-authority.mjs'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The public loader handoff with its factory and deferred stylesheets.
 * @typedef {{
 *   id: string,
 *   factory: (require: (specifier: string) => unknown) => ClientExports,
 *   meta?: () => { stylesheets?: Record<string, { text: (context: { asset: (reference: string) => string }) => string }> },
 * }} LoaderHandoff
 */

/**
 * The plugin face the bundle's CJS exports must present to the shell.
 * @typedef {{ apply?: unknown, inject?: unknown }} ClientExports
 */

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
 * cost. The GFM/math image safety pass adds about 88 KB to the former 660 KB
 * bundle; 800 KiB leaves about 9% headroom over the measured 750 KB result.
 * A bundle above the ceiling fails the build. Raise the ceiling only with a
 * measured reason.
 */
export const MAX_CLIENT_BUNDLE_BYTES = 800 * 1024

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

/** Fails the build when a harness module reaches the artifact that may not be
 *  inlined: a second copy of a shell singleton (`ctx`, the store, the UI
 *  primitives) carries no loader identity, so it would silently split state
 *  across two instances. Reads the specifiers the graph actually resolves (the
 *  same unit the harness's own rule is written in), so a symlinked sibling
 *  checkout and a registry install are policed identically.
 * @type {import('esbuild').Plugin}
 */
const harnessPurityPlugin = {
  name: 'harness-bundle-purity',
  setup(build) {
    /** @type {Set<string>} */
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
 * @returns {Record<string, unknown>} mapping of external specifier to module entity.
 */
function platformModuleTable() {
  /** @type {Record<string, unknown>} */
  const table = {}
  for (const specifier of EXTERNALS) {
    if (!specifier.startsWith('@deepseek-ai/')) table[specifier] = require(specifier)
  }
  return table
}

/**
 * Artifact + handoff verification. Runs on every successful build (including
 * watch) through the verify plugin below.
 * @returns void; throws when the loader handoff fails.
 */
export function verifyBundle(bundlePath = join(root, 'lib/client.js')) {
  verifyBundleSource(readFileSync(bundlePath, 'utf8'), bundlePath)
}

/**
 * Verify a bundle's source text, before or after the metadata handoff is
 * spliced in.
 * @param {string} source - the bundle source.
 * @param {string} bundlePath - the path reported in failure messages.
 */
function verifyBundleSource(source, bundlePath) {
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
  /** @type {LoaderHandoff | undefined} */
  let handoff
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const window = dom.window
  window.__ModuleLoader__ = {
    load: (/** @type {LoaderHandoff} */ value) => {
      handoff = value
    },
  }
  try {
    vm.runInNewContext(source, { window, document: window.document })
    if (handoff === undefined || handoff.id !== PLUGIN_ID) {
      throw new Error(`client bundle did not register the ${PLUGIN_ID} factory`)
    }
    if (typeof handoff.factory !== 'function') {
      throw new Error('client bundle factory is not a function')
    }
    const stylesheets = handoff.meta?.()?.stylesheets
    if (stylesheets === undefined || Object.keys(stylesheets).length === 0) {
      throw new Error('client bundle must register stylesheets in loader metadata')
    }
    for (const [path, style] of Object.entries(stylesheets)) {
      const css = style.text({ asset: (reference) => reference })
      if (typeof css !== 'string' || css.trim() === '') {
        throw new Error(`client stylesheet ${path} must produce CSS text`)
      }
    }
    // Resolve externals through the loader's module table so this check covers
    // the same runtime dependency boundary as the host.
    const platform = platformModuleTable()
    const exported = handoff.factory((specifier) => {
      if (EXTERNALS.includes(specifier)) return platform[specifier] ?? {}
      throw new Error(`bundle required non-external ${specifier} at load time`)
    })
    if (typeof exported?.apply !== 'function' || !Array.isArray(exported?.inject)) {
      throw new Error('client bundle must export the apply/inject plugin face')
    }
    if (window.document.querySelector('style') !== null) {
      throw new Error('client bundle inserted a style element outside the host renderer')
    }
  } finally {
    window.close()
  }
  console.log(
    `client bundle ok: ${bundlePath} (${source.length} bytes, ${EXTERNALS.join(', ')} external)`,
  )
}

const STYLE_METADATA_MARKER = '/* dsh-zotero stylesheet metadata */'

/**
 * Compile CSS class maps and attach their stylesheets to the loader registration.
 * @param {boolean} verify - assemble, check and write the production artifact.
 * @returns {import('esbuild').Plugin}
 */
function cssModulesPlugin(verify) {
  return {
    name: 'css-modules',
    setup(build) {
      /** @type {Map<string, string>} */
      const styles = new Map()
      build.onLoad({ filter: /\.module\.css$/ }, (args) => {
        const source = readFileSync(args.path, 'utf8')
        const { code, exports: classMap } = transformCss({
          filename: args.path,
          code: Buffer.from(source),
          cssModules: true,
          minify: true,
        })
        const names = Object.fromEntries(
          Object.entries(
            /** @type {import('lightningcss').CSSModuleExports} */ (
              /** @type {unknown} */ (classMap)
            ),
          )
            .sort(([a], [b]) => a.localeCompare(b, 'en'))
            .map(([original, info]) => [original, info.name]),
        )
        const path = relative(root, args.path).split('\\').join('/')
        styles.set(path, Buffer.from(code).toString('utf8'))
        return { contents: 'export default ' + JSON.stringify(names), loader: 'js' }
      })
      if (!verify) return
      build.onEnd((result) => {
        if (result.errors.length > 0) return
        const bundle = result.outputFiles?.find(
          (file) => file.path === build.initialOptions.outfile,
        )
        const output =
          bundle && result.metafile?.outputs[relative(root, bundle.path).split('\\').join('/')]
        if (
          bundle === undefined ||
          output === undefined ||
          !bundle.text.includes(STYLE_METADATA_MARKER)
        ) {
          throw new Error('client build did not produce the stylesheet metadata handoff')
        }
        // Select the styles in this output, including after imports change in watch mode.
        const descriptors = Object.keys(output.inputs).flatMap((path) => {
          const css = styles.get(path)
          return css === undefined
            ? []
            : [JSON.stringify(path) + ':{text:()=>' + JSON.stringify(css) + '}']
        })
        const metadata = ',meta:()=>({stylesheets:{' + descriptors.join(',') + '}})'
        // The marker is in the footer, after the mapped factory code.
        const source = bundle.text.replace(STYLE_METADATA_MARKER, () => metadata)
        verifyBundleSource(source, bundle.path)
        mkdirSync(dirname(bundle.path), { recursive: true })
        for (const file of result.outputFiles ?? []) {
          if (file !== bundle) writeFileSync(file.path, file.contents)
        }
        writeFileSync(bundle.path, source)
      })
    },
  }
}

/**
 * The esbuild plugins that enforce client authority and compile CSS modules.
 * @param options {{ verify?: boolean }} pass verify: false for fixture builds.
 * @returns {import('esbuild').Plugin[]}
 */
export function clientBuildPlugins({ verify = true } = {}) {
  return [harnessPurityPlugin, createClientAuthorityPlugin(), cssModulesPlugin(verify)]
}

/**
 * Metafile inputs are required for the local-source allowlist re-check.
 * @type {import('esbuild').BuildOptions}
 */
const options = {
  absWorkingDir: root,
  entryPoints: [join(root, 'src/client/index.ts')],
  plugins: clientBuildPlugins(),
  outfile: join(root, 'lib/client.js'),
  write: false,
  bundle: true,
  metafile: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // The harness serves these scripts as UTF-8. Keep localized text in that
  // encoding to avoid expanding it into Unicode escapes in the bundle.
  charset: 'utf8',
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
  external: /** @type {string[]} */ (EXTERNALS),
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
    js: 'return module.exports; }' + STYLE_METADATA_MARKER + ' });',
  },
}

/**
 * Build the browser client bundle, once or in watch mode.
 *
 * Exported so `scripts/build-prepare.mjs` (the source-install build) can emit
 * the same artifact without duplicating this configuration; running this file
 * directly keeps the one-shot/watch CLI behaviour. Authority and handoff
 * gates run on every successful rebuild.
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
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildClientBundle({ watch: process.argv.includes('--watch') })
}
