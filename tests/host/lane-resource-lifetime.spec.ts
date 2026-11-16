/** A lane owns its entire Cordis tree, including a partially booted tree. */
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { setupHostLane } from '../helpers/lanes/host-lane.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { deferred } from '../helpers/sync.js'

it('joins asynchronous resource cleanup and makes repeated teardown idempotent', async () => {
  const disposing = deferred<void>()
  const release = deferred<void>()
  const cleanup = vi.fn(async () => {
    disposing.resolve()
    await release.promise
  })
  const lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        ctx.effect(() => cleanup)
      },
    },
  )
  const close = vi.spyOn(lane.mock, 'close')
  try {
    const first = lane.teardown()
    await disposing.promise
    expect(lane.teardown()).toBe(first)
    expect(close).not.toHaveBeenCalled()
    release.resolve()
    await first
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    release.resolve()
    await lane.teardown()
  }
})

it('releases composed resources and the mock listener when boot fails', async () => {
  const cleanup = vi.fn()
  const close = vi.spyOn(MockZotero.prototype, 'close')
  const compose = async (ctx: Context) => {
    ctx.effect(() => cleanup)
    throw new Error('composition failed')
  }
  try {
    await expect(setupHostLane({}, { compose })).rejects.toThrow('composition failed')
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    close.mockRestore()
  }
})
