import { deferred } from '../helpers/sync.ts'
/**
 * The `zotero_changes` tool surface: baseline readings and minted cursors,
 * diffs over items, child objects, trash, and deletions, group libraries,
 * unobservable kinds, and the render of every digest and withheld cursor.
 * @module tests/tools/changes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  jobPromotedMessage,
  JOBS_UNAVAILABLE_MESSAGE,
  jobStartedMessage,
  RUN_IN_BACKGROUND_DISABLED_MESSAGE,
} from '../../src/job-runner.js'
import { TestJobRegistry } from '../helpers/fake-jobs.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

describe('background jobs and promotion', () => {
  it('declares the run_in_background parameter statically regardless of composition', async () => {
    const defaultTool = lane.tool('zotero_changes')!
    const defaultProps = (defaultTool.parameters as { properties?: Record<string, unknown> })
      .properties
    expect(defaultProps?.run_in_background).toBeDefined()
  })

  it('refuses run_in_background when enableRunInBackground is disabled in config', async () => {
    await lane.teardown()
    lane = await setupHostLane({ enableRunInBackground: false })
    runTool = lane.runTool

    const result = await runTool('zotero_changes', { run_in_background: true })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(
      `Error: ${RUN_IN_BACKGROUND_DISABLED_MESSAGE}`,
    )
    // A rejection the model must act on carries its code, like every other
    // expected refusal.
    expect(result.error?.info).toMatchObject({ code: 'ZOTERO_RUN_IN_BACKGROUND_DISABLED' })
  })

  it('refuses run_in_background when ctx.jobs service is unavailable', async () => {
    const result = await runTool('zotero_changes', { run_in_background: true })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(`Error: ${JOBS_UNAVAILABLE_MESSAGE}`)
    expect(result.error?.info).toMatchObject({ code: 'ZOTERO_JOBS_UNAVAILABLE' })
  })

  it('starts a background job and returns immediately when run_in_background is requested', async () => {
    let jobRegistry!: TestJobRegistry
    await lane.teardown()
    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          jobRegistry = new TestJobRegistry(ctx)
        },
      },
    )
    runTool = lane.runTool
    lane.mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([], { 'Last-Modified-Version': '42', 'Zotero-Server-ID': 'S1' }),
    )

    const result = expectValue(
      await runTool('zotero_changes', { run_in_background: true }),
      'zotero_changes',
    )

    expect(result.value).toEqual({
      kind: 'background',
      resultSessionId: 'test-session',
      jobId: 'zotero-1',
    })
    expect((result.content[0] as { text: string }).text).toBe(jobStartedMessage('zotero-1'))

    const job = jobRegistry.jobs.get('zotero-1' as never)!
    const outcome = await job.hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.result).toContain('full result persisted')

    const toolDef = lane.tool('zotero_changes')!
    const view = toolDef.presentResult?.({}, result as never)
    expect(view?.title).toBe('Zotero changes: background job zotero-1')
  })

  it('promotes to a background job when execution exceeds foregroundWaitMs', async () => {
    await lane.teardown()
    lane = await setupHostLane(
      { foregroundWaitMs: 20 },
      {
        compose: async (ctx) => {
          await ctx.plugin(TestJobRegistry)
        },
      },
    )
    runTool = lane.runTool
    const release = deferred<void>()
    lane.mock.route('GET', '/api/users/0/items/top', async (req, res, helpers) => {
      await release.promise
      return helpers.json([], { 'Last-Modified-Version': '42', 'Zotero-Server-ID': 'S1' })
    })

    const result = expectValue(await runTool('zotero_changes', {}), 'zotero_changes')
    release.resolve()
    await (lane.ctx.jobs as unknown as TestJobRegistry).jobs.get('zotero-1' as never)!.hooks.done

    expect(result.value).toEqual({
      kind: 'promoted',
      resultSessionId: 'test-session',
      jobId: 'zotero-1',
      timeoutMs: 20,
      message: jobPromotedMessage('zotero-1', 20),
    })
    expect((result.content[0] as { text: string }).text).toBe(jobPromotedMessage('zotero-1', 20))

    const toolDef = lane.tool('zotero_changes')!
    const view = toolDef.presentResult?.({}, result as never)
    expect(view?.title).toBe('Zotero changes: promoted to job zotero-1')
  })

  it('returns the foreground result when execution completes within foregroundWaitMs', async () => {
    await lane.teardown()
    lane = await setupHostLane(
      { foregroundWaitMs: 1000 },
      {
        compose: async (ctx) => {
          await ctx.plugin(TestJobRegistry)
        },
      },
    )
    runTool = lane.runTool
    lane.mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([], { 'Last-Modified-Version': '42', 'Zotero-Server-ID': 'S1' }),
    )

    const result = expectValue(await runTool('zotero_changes', {}), 'zotero_changes')

    expect((result.value as { cursor: { version: number } }).cursor.version).toBe(42)
  })
})
