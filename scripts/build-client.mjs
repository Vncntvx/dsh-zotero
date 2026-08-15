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

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Plugin id stamped into the loader handoff; must equal the npm package name. */
const PLUGIN_ID = 'dsh-zotero'

/** Platform modules the loader's module table answers; never bundled. */
const EXTERNALS = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

const options = {
  entryPoints: [join(root, 'src/client/index.ts')],
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
