/**
 * Browser-half entry: the apply wiring registers the page dictionaries and
 * reads the five component settings namespaces through the shared form.
 * @module tests/client/apply-forms
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../../src/client/locales.ts'
import {
  ENRICHMENT_SETTINGS_NAMESPACE,
  READER_SETTINGS_NAMESPACE,
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../../src/settings-namespace.ts'
import { ZOTERO_LIBRARY_SETTINGS_NAMESPACE } from '../../src/contract.ts'
import { applyEntry, fakeWorld } from './helpers/apply-world.ts'

describe('the browser-half entry forms', () => {
  it('registers the page dictionaries on apply', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.dictionaries).toEqual([{ ns: 'zotero', dict: { zh, en } }])
  })

  it('reads the shared form for the shared namespace constant', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.formIds).toEqual([
      ZOTERO_SETTINGS_NAMESPACE,
      SCHOLARLY_SETTINGS_NAMESPACE,
      ENRICHMENT_SETTINGS_NAMESPACE,
      ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
      READER_SETTINGS_NAMESPACE,
    ])
  })
})
