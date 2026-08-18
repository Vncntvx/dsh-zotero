/**
 * The build identity stamped into the client bundle: the guarded globals
 * read the esbuild `define` values inside a built bundle and degrade to
 * `unknown` in a plain module environment (the test runner).
 * @module tests/client/build-info
 */

import { afterEach, describe, expect, it } from 'vitest'
import { buildCommit, buildInfoOf, buildVersion } from '../../src/client/build-info.ts'

type Globals = {
  __DSH_ZOTERO_VERSION__?: unknown
  __DSH_ZOTERO_COMMIT__?: unknown
}

afterEach(() => {
  const globals = globalThis as unknown as Globals
  delete globals.__DSH_ZOTERO_VERSION__
  delete globals.__DSH_ZOTERO_COMMIT__
})

describe('build-info', () => {
  it('degrades to unknown outside a built bundle', () => {
    expect(buildVersion()).toBe('unknown')
    expect(buildCommit()).toBe('unknown')
    expect(buildInfoOf()).toBe('unknown · unknown')
  })

  it('reads the stamped globals when a built bundle defines them', () => {
    const globals = globalThis as unknown as Globals
    globals.__DSH_ZOTERO_VERSION__ = '0.3.3'
    globals.__DSH_ZOTERO_COMMIT__ = 'abc1234'
    expect(buildVersion()).toBe('0.3.3')
    expect(buildCommit()).toBe('abc1234')
    expect(buildInfoOf()).toBe('0.3.3 · abc1234')
  })

  it('treats an empty or non-string stamp as unknown', () => {
    const globals = globalThis as unknown as Globals
    globals.__DSH_ZOTERO_VERSION__ = ''
    globals.__DSH_ZOTERO_COMMIT__ = 42
    expect(buildVersion()).toBe('unknown')
    expect(buildCommit()).toBe('unknown')
  })
})
