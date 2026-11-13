/**
 * The three heavy scholarly tools advertise `run_in_background` exactly while
 * the deployment can serve it: the flag is on and a job registry is mounted.
 * A registry that unloads degrades to the foreground schema, and a live switch
 * flip re-registers the schemas.
 * @module tests/scholarly/service-background-parameter
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { ScholarlyService } from '../../src/scholarly/service.js'
import { composeRealJobs } from '../helpers/real-jobs.ts'
import { bootScholarlyContext } from './fixtures.js'

const owned: Context[] = []

afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (ctx) => await ctx.fiber.dispose()))
})

const HEAVY_TOOLS = ['scholarly_search', 'scholarly_read', 'scholarly_verify'] as const

/** Whether each heavy tool's schema carries the parameter. */
function declared(ctx: Context): boolean[] {
  const schemas = ctx.tools.schemas()
  return HEAVY_TOOLS.map((name) =>
    JSON.stringify(schemas.find((schema) => schema.name === name) ?? {}).includes(
      'run_in_background',
    ),
  )
}

describe('scholarly background parameter', () => {
  it('follows the registry and the live deployment switch', async () => {
    const ctx = await bootScholarlyContext()
    owned.push(ctx)
    const service = new ScholarlyService(ctx, {
      email: createVolatile('switch@example.edu'),
      enableRunInBackground: createVolatile(true),
    })

    // No registry: the foreground schema registers first.
    expect(declared(ctx)).toEqual([false, false, false])

    const jobs = await composeRealJobs(ctx)
    expect(declared(ctx)).toEqual([true, true, true])

    // A live flip re-registers the two arms.
    service.config.enableRunInBackground = createVolatile(false)
    ctx.emit('loader/volatile-update', [['enableRunInBackground']])
    expect(declared(ctx)).toEqual([false, false, false])

    service.config.enableRunInBackground = createVolatile(true)
    ctx.emit('loader/volatile-update', [['enableRunInBackground']])
    expect(declared(ctx)).toEqual([true, true, true])

    // The registry unloading returns the foreground arm instead of dropping
    // the tools from the registry.
    await jobs.fiber?.dispose()
    expect(declared(ctx)).toEqual([false, false, false])
    expect(ctx.tools.schemas().map((schema) => schema.name)).toEqual(
      expect.arrayContaining([...HEAVY_TOOLS]),
    )
  })

  it('never declares the parameter while the switch is off', async () => {
    const ctx = await bootScholarlyContext()
    owned.push(ctx)
    new ScholarlyService(ctx, {
      email: createVolatile('off@example.edu'),
      enableRunInBackground: createVolatile(false),
    })
    await composeRealJobs(ctx)
    expect(declared(ctx)).toEqual([false, false, false])
  })
})
