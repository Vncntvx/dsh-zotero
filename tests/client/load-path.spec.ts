// @vitest-environment jsdom
/**
 * The browser entry's module shape, which the Loader's export normalizer reads
 * the same way it reads a host entry's.
 *
 * `src/client/index.ts` is a namespace plugin: it exports `inject` and `apply`
 * as module members and no default. That is load-bearing. `unwrapExports`
 * (vendor `cordis-plugin-loader`, proven against the four host entries in
 * `tests/host/load-path`) returns `namespace.default ?? namespace`, so a
 * default export added here would make the browser loader apply that one value
 * while the named `inject` — the service list the shell waits on — silently
 * disappeared. The loader package is host-side and this lane's program carries
 * no Node types, so the consequence is asserted where it starts: the namespace
 * itself (patterns-5 P-672).
 * @module tests/client/load-path
 */

import { describe, expect, it } from 'vitest'
import * as namespace from '../../src/client/index.ts'

describe('the browser entry namespace', () => {
  it('has no default export', () => {
    expect('default' in namespace).toBe(false)
  })

  it('keeps the named plugin members the shell loads', () => {
    expect(typeof namespace.apply).toBe('function')
    expect(namespace.inject).toContain('remote')
    expect(namespace.inject).toContain('slots')
  })
})
