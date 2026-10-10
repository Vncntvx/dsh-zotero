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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { clientBuildPlugins, verifyBundle } from '../../scripts/build-client.mjs'

/** A valid loader-handoff bundle: platform-module requires, the plugin face. */
const GOOD_BUNDLE = `window.__ModuleLoader__.load({ id: 'dsh-zotero', factory: (require) => {
  require('react')
  require('react/jsx-runtime')
  require('@deepseek-ai/dsh-client-store')
  require('@deepseek-ai/dsh-client-ui-primitives')
  return { apply() {}, inject: ['locale'] }
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

describe('verifyBundle', () => {
  it('accepts a handoff with the plugin id, external-only requires, and the apply face', async () => {
    await withBundle(GOOD_BUNDLE, (path) => {
      expect(() => verifyBundle(path)).not.toThrow()
    })
  })

  it('rejects a handoff id that is not the npm package name', async () => {
    await withBundle(GOOD_BUNDLE.replace("id: 'dsh-zotero'", "id: 'other-plugin'"), (path) => {
      expect(() => verifyBundle(path)).toThrow(/dsh-zotero/)
    })
  })

  it('rejects a factory whose load-time requires leave the platform modules', async () => {
    await withBundle(GOOD_BUNDLE.replace("require('react')", "require('zod')"), (path) => {
      expect(() => verifyBundle(path)).toThrow(/non-external zod/)
    })
  })

  it('rejects a factory that does not export the apply/inject plugin face', async () => {
    await withBundle(GOOD_BUNDLE.replace('apply() {}, inject:', 'other() {}, inject:'), (path) => {
      expect(() => verifyBundle(path)).toThrow(/apply\/inject/)
    })
  })

  it('rejects host-schema runtime text that shipped without a graph edge', async () => {
    await withBundle(`${GOOD_BUNDLE}\n// pasted codec: ZodError`, (path) => {
      expect(() => verifyBundle(path)).toThrow(/host-schema marker/)
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
  it('refuses a graph that value-imports a host-owned package at resolve time', async () => {
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
    await expect(
      esbuild.build({
        entryPoints: [graphEntry],
        outfile: join(graphDir, 'out.js'),
        bundle: true,
        metafile: true,
        format: 'cjs',
        platform: 'browser',
        target: 'es2022',
        external: ['react'],
        plugins: clientBuildPlugins({ verify: false }),
      }),
    ).rejects.toThrow(/zod/)
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
