/**
 * The client bundle's authority rules, driven through the same functions the
 * build gates on (`scripts/build-client.mjs`): the loader-handoff self-check
 * (`verifyBundle`) against fixture bundles, and the esbuild plugin list
 * (`clientBuildPlugins`) against fixture graphs: a host-package import is
 * refused at resolve time, and a clean external-only graph builds.
 * @module tests/unit/build-client-bundle
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import {
  assertLoaderApi,
  clientBuildPlugins,
  CLIENT_LOADER_API,
  LEGACY_STYLESHEET_MARKER,
  MAX_CLIENT_BUNDLE_BYTES,
  verifyBundle,
} from '../../../scripts/build-client.mjs'

/** A valid loader-handoff bundle: platform-module requires, the plugin face. */
const GOOD_BUNDLE = `window.__ModuleLoader__.load({ id: 'dsh-zotero', factory: (require) => {
  require('react')
  require('react/jsx-runtime')
  require('@deepseek-ai/dsh-client-store')
  require('@deepseek-ai/dsh-client-ui-primitives')
  // The legacy handoff injects this tag; CLIENT_LOADER_API names it.
  var cssTag = '${LEGACY_STYLESHEET_MARKER}'
  return { apply() {}, inject: ['locale'], cssTag }
} });`

/** One fixture bundle on disk; `verifyBundle` reads a path, not a string. */
async function withBundle(source: string, run: (path: string) => Promise<void> | void) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-bundle-'))
  try {
    const path = join(dir, 'client.js')
    await writeFile(path, source, 'utf8')
    await run(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('the loader-API pairing', () => {
  it('accepts the pinned legacy handoff the bundle actually produces', () => {
    expect(CLIENT_LOADER_API).toBe('legacy-stylesheet-tag')
    expect(() => assertLoaderApi(CLIENT_LOADER_API, GOOD_BUNDLE)).not.toThrow()
  })

  it('refuses the legacy tag once the constant names the meta handoff', () => {
    expect(() => assertLoaderApi('meta-stylesheets', GOOD_BUNDLE)).toThrow(/meta-stylesheets/)
  })

  it('refuses a migrated bundle while the constant still names the legacy handoff', () => {
    expect(() => assertLoaderApi('legacy-stylesheet-tag', 'export default 1')).toThrow(
      /still names the legacy handoff/,
    )
  })
})

describe('verifyBundle', () => {
  it('accepts a handoff with the plugin id, external-only requires, and the apply face', async () => {
    await withBundle(GOOD_BUNDLE, (path) => {
      expect(() => verifyBundle(path)).not.toThrow()
    })
  })

  it('runs the factory against real react modules seeded by the platform', async () => {
    // Platform modules allow evaluating class components extending React.Component.
    const boundaryBundle = `window.__ModuleLoader__.load({ id: 'dsh-zotero', factory: (require) => {
  var React = require('react')
  class SurfaceBoundary extends React.Component {
    static getDerivedStateFromError() { return { failed: true } }
    render() { return this.props.children }
  }
  var probe = new SurfaceBoundary({ children: null })
  var cssTag = '${LEGACY_STYLESHEET_MARKER}'
  return { apply() {}, inject: ['locale'], boundary: SurfaceBoundary, probed: probe !== undefined, cssTag }
} });`
    await withBundle(boundaryBundle, (path) => {
      expect(() => verifyBundle(path)).not.toThrow()
    })
  })

  it('rejects a handoff id that is not the npm package name', async () => {
    await withBundle(GOOD_BUNDLE.replace("id: 'dsh-zotero'", "id: 'other-plugin'"), (path) => {
      expect(() => verifyBundle(path)).toThrow(/dsh-zotero/)
    })
  })

  it('rejects a factory whose load-time requires leave the platform modules', async () => {
    await withBundle(GOOD_BUNDLE.replace("require('react')", "require('lodash')"), (path) => {
      expect(() => verifyBundle(path)).toThrow(/non-external lodash/)
    })
  })

  it('rejects a factory that does not export the apply/inject plugin face', async () => {
    await withBundle(GOOD_BUNDLE.replace('apply() {}, inject:', 'other() {}, inject:'), (path) => {
      expect(() => verifyBundle(path)).toThrow(/apply\/inject/)
    })
  })

  it('rejects a bundle over the byte ceiling before evaluating it', async () => {
    // One byte over the ceiling: the failure names the size, not the handoff.
    const oversized = `${GOOD_BUNDLE}\n//${'x'.repeat(MAX_CLIENT_BUNDLE_BYTES)}`
    await withBundle(oversized, (path) => {
      expect(() => verifyBundle(path)).toThrow(/over the \d+-byte ceiling/)
    })
  })
})

/** One fixture graph directory for the esbuild cases; created before all, cleaned at exit. */
let graphDir: string
let graphEntry: string

beforeAll(async () => {
  graphDir = await mkdtemp(join(tmpdir(), 'dsh-zotero-graph-'))
  graphEntry = join(graphDir, 'entry.ts')
})

afterAll(async () => {
  if (graphDir !== undefined) {
    await rm(graphDir, { recursive: true, force: true })
  }
})

describe('clientBuildPlugins', () => {
  it('rejects a resolvable graph that inlines the shared Zod runtime', async () => {
    await writeFile(
      join(graphDir, 'thief.ts'),
      "import { z } from 'zod'\nexport const schema = z.object({})\n",
      'utf8',
    )
    await writeFile(
      graphEntry,
      "import { schema } from './thief.ts'\nexport default schema\n",
      'utf8',
    )
    const options: esbuild.BuildOptions = {
      entryPoints: [graphEntry],
      outfile: join(graphDir, 'out.js'),
      bundle: true,
      metafile: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      external: ['react'],
      nodePaths: [fileURLToPath(new URL('../../../node_modules', import.meta.url))],
      logLevel: 'silent',
    }
    const unguarded = await esbuild.build(options)
    expect(
      Object.keys(unguarded.metafile!.inputs).some((key) => /node_modules\/zod\//.test(key)),
    ).toBe(true)
    await expect(
      esbuild.build({
        ...options,
        plugins: clientBuildPlugins({ verify: false }),
      }),
    ).rejects.toThrow(/client graph authority:.*zod.*neither externalized/)
  })

  it('builds a clean external-only graph', async () => {
    await writeFile(
      graphEntry,
      "import { createElement } from 'react'\nexport default createElement('div')\n",
      'utf8',
    )
    await expect(
      esbuild.build({
        entryPoints: [graphEntry],
        outfile: join(graphDir, 'out2.js'),
        bundle: true,
        metafile: true,
        format: 'cjs',
        platform: 'browser',
        target: 'es2022',
        external: ['react'],
        plugins: clientBuildPlugins({ verify: false }),
      }),
    ).resolves.toBeDefined()
  })
})
