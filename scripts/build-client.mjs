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
import { dirname, join } from 'node:path'
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

/** Platform modules the loader's module table answers; never bundled. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

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
  plugins: [cssModulesPlugin],
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

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('watching src/client for changes…')
} else {
  await esbuild.build(options)
  verifyBundle()
}
