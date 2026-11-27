/**
 * The shipped host entry points through the Loader's real export normalizer.
 *
 * Every other spec imports an entry's `default` directly, so nothing exercised
 * the step between a module namespace and the plugin the Loader applies:
 * `unwrapExports` (vendor `cordis-plugin-loader`, called from the entry's
 * `config/entry.ts`). That step decides which object the Loader reads `inject`
 * and `Config` from.
 *
 * The browser entry is a namespace plugin and is asserted in its own lane
 * (`tests/client/load-path`), because this lane excludes `src/client` from its
 * program. patterns-5 P-672/P-673.
 * @module tests/host/load-path
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

/** A booted Loader, with no workspace and no entries: only its normalizer. */
async function bootLoader(): Promise<Loader> {
  const context = new Context()
  await context.plugin(Loader)
  return context.loader
}

describe('the Loader export path every host entry goes through', () => {
  it('unwraps each host entry to the class the Loader will apply', async () => {
    const loader = await bootLoader()
    const entries = [
      ['dsh-zotero', await import('../../src/index.js')],
      ['dsh-zotero/library', await import('../../src/library/index.js')],
      ['dsh-zotero/scholarly', await import('../../src/scholarly/index.js')],
      ['dsh-zotero/enrichment', await import('../../src/enrichment/index.js')],
      ['dsh-zotero/reader', await import('../../src/reader/index.js')],
    ] as const
    for (const [name, namespace] of entries) {
      const plugin = loader.unwrapExports(namespace)
      // The normalizer must return the entry's own class, not a namespace
      // wrapper: the Loader reads `Config` and the lifecycle hooks off what it
      // gets back, and a wrapper has neither.
      expect(typeof plugin, name).toBe('function')
      expect(plugin, name).toBe(namespace.default)
      expect(plugin.Config, name).toBeDefined()
    }
  })

  it('keeps the dependency statics on the entries that declare them', async () => {
    const loader = await bootLoader()
    const core = loader.unwrapExports(await import('../../src/index.js'))
    const library = loader.unwrapExports(await import('../../src/library/index.js'))
    const scholarly = loader.unwrapExports(await import('../../src/scholarly/index.js'))
    expect(core.inject).toEqual(['tools', 'systemPrompt'])
    expect(library.inject).toEqual(['zotero'])
    expect(scholarly.inject).toEqual(['tools', 'systemPrompt'])
  })
})
