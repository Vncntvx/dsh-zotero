/** Importing remote descriptors must not construct the unused schema graph. */
import { expect, it, vi } from 'vitest'
import { statusView } from '../helpers/status-view.js'

it('constructs object schemas only on first use and reuses the materialized boundary', async () => {
  const actual = await vi.importActual<typeof import('zod')>('zod')
  const object = vi.fn(actual.z.object)
  vi.resetModules()
  vi.doMock('zod', () => ({ ...actual, z: { ...actual.z, object } }))
  try {
    const wire = await import('../../src/wire-schemas.js')
    expect(wire.ZOTERO_COMMON_INVOCATIONS.length).toBeGreaterThan(20)
    expect(object).not.toHaveBeenCalled()
    expect(wire.zoteroStatusSchema.parse(statusView())).toEqual(statusView())
    const firstUse = object.mock.calls.length
    expect(firstUse).toBeGreaterThan(0)
    wire.zoteroStatusSchema.parse(statusView())
    expect(object).toHaveBeenCalledTimes(firstUse)
  } finally {
    vi.doUnmock('zod')
    vi.resetModules()
  }
})
