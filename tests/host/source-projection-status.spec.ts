/**
 * The Zotero service's projection-registration states against a composed
 * registry: the ready handle gates the reported state, a registration failure
 * stays explicit after the fiber unwinds, and a composed-but-pending attempt
 * reads as pending rather than absence. The fold itself is owned by
 * `source-ledger.spec.ts`.
 * @module tests/host/source-projection-status
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_SOURCE_PROJECTION_FAILED } from '../../src/contract.js'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { deferred } from '../helpers/sync.js'
import { projectionHandle, stubProjections } from './support/session-projections.ts'
import ZoteroService from '../../src/index.js'

describe('the projection registration', () => {
  it('registers the trail unit when the registry is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const registered = stubProjections(ctx)
    const service = new ZoteroService(ctx, { writeEnabled: true })
    expect(service.writeEnabled()).toBe(true)
    await expect(service.sourceProjectionStatus(new AbortController().signal)).resolves.toEqual({
      state: 'ready',
    })
    expect(registered.map((entry) => entry.key)).toEqual(['zoteroSources'])
    await ctx.fiber.dispose()
  })

  it('waits for the registry to return its ready handle before reporting ready', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const started = deferred<void>()
    const ready = deferred<unknown>()
    stubProjections(ctx, () => {
      started.resolve()
      return ready.promise
    })
    const service = new ZoteroService(ctx, {})
    const status = service.sourceProjectionStatus(new AbortController().signal)
    await started.promise
    let settled = false
    void status.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    ready.resolve(projectionHandle())
    await expect(status).resolves.toEqual({ state: 'ready' })
    await ctx.fiber.dispose()
  })

  it('keeps a registration failure explicit after the injection fiber unwinds', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const started = deferred<void>()
    const failure = new Error('projection storage unavailable')
    stubProjections(ctx, () => {
      started.resolve()
      return Promise.reject(failure)
    })
    const service = new ZoteroService(ctx, {})
    const signal = new AbortController().signal
    const status = service.sourceProjectionStatus(signal)
    await started.promise
    await expect(status).resolves.toEqual({
      state: 'failed',
      code: ZOTERO_SOURCE_PROJECTION_FAILED,
    })
    await expect(service.sourceProjectionStatus(signal)).resolves.toEqual({
      state: 'failed',
      code: ZOTERO_SOURCE_PROJECTION_FAILED,
    })
    await ctx.fiber.dispose()
  })

  it('releases the projection registration with the service fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const projections = new SessionProjectionRegistry(ctx)
    const serviceFiber = ctx.plugin(ZoteroService, {})
    await serviceFiber

    await expect(
      (ctx.get('zotero') as ZoteroService).sourceProjectionStatus(new AbortController().signal),
    ).resolves.toEqual({ state: 'ready' })
    const registrations = (
      projections as unknown as {
        registrations: Map<string, { refs: number }>
      }
    ).registrations
    expect(registrations.get('zoteroSources')?.refs).toBe(1)

    await serviceFiber.dispose()

    expect(registrations.get('zoteroSources')?.refs).toBe(0)
    await ctx.fiber.dispose()
  })

  it('disposes a registration handle that resolves after service teardown', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const started = deferred<void>()
    const ready = deferred<unknown>()
    const disposed = deferred<void>()
    stubProjections(ctx, () => {
      started.resolve()
      return ready.promise
    })
    const serviceFiber = ctx.plugin(ZoteroService, {})
    await started.promise
    await serviceFiber.dispose()

    ready.resolve({ stateOf: () => ({}), dispose: async () => disposed.resolve() })
    await disposed.promise
    await ctx.fiber.dispose()
  })
})
