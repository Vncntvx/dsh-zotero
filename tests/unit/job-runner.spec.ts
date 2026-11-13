/**
 * Unit tests for `src/job-runner.ts` (long-running jobs integration).
 *
 * The registry is the real `LocalJobRegistry` composed with the two seams its
 * admission needs (see `tests/helpers/real-jobs`). A stand-in used to answer
 * as if `wait` ignored its caller and `kill` returned a `JobView`; nothing
 * here would have noticed the runner drifting away from the contract it runs
 * against.
 * @module tests/unit/job-runner
 */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ZoteroJobRunner,
  JOBS_UNAVAILABLE_MESSAGE,
  RUN_IN_BACKGROUND_DISABLED_MESSAGE,
  executeWithJobs,
  jobStartedMessage,
  jobPromotedMessage,
  jobWaitFailedMessage,
} from '../../src/job-runner.js'
import { ZOTERO_NOT_RUNNING, ZoteroError } from '../../src/errors.js'
import { fakeExec, OWNER, ownerOf, registryOf } from '../helpers/job-runner-fixtures.js'

describe('ZoteroJobRunner', () => {
  it('reports settled outcomes to the sink with the stable code when one exists', async () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const jobs = await registryOf()
    // The owner must resolve to a live agent for an owned job to be admitted.
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry, sink)

    const completed = runner.start({
      label: 'sunny job',
      exec: fakeExec(),
      run: async () => 'done',
    })
    await completed.done
    expect(sink.info).toHaveBeenCalledWith('job.outcome', 'sunny job completed')

    const zoteroFailure = runner.start({
      label: 'zotero job',
      exec: fakeExec(),
      run: async () => {
        throw new ZoteroError('nope', ZOTERO_NOT_RUNNING)
      },
    })
    await zoteroFailure.done
    expect(sink.error).toHaveBeenCalledWith(
      'job.outcome',
      expect.stringContaining('zotero job failed: nope'),
      { errorCode: ZOTERO_NOT_RUNNING },
    )

    const plainFailure = runner.start({
      label: 'plain job',
      exec: fakeExec(),
      run: async () => {
        throw new Error('plain boom')
      },
    })
    await plainFailure.done
    expect(sink.error).toHaveBeenCalledWith(
      'job.outcome',
      expect.stringContaining('plain job failed: plain boom'),
      undefined,
    )
  })

  it('reports availability based on registry presence', async () => {
    const jobs = await registryOf()
    expect(new ZoteroJobRunner().isAvailable).toBe(false)
    expect(new ZoteroJobRunner(jobs.registry).isAvailable).toBe(true)
  })

  it('formats job started and promoted messages by exact identity', () => {
    expect(jobStartedMessage('zotero-1')).toBe('started background job zotero-1')
    expect(jobPromotedMessage('zotero-1', 4000)).toBe(
      'operation timed out after 4000ms and was promoted to background job zotero-1',
    )
    expect(jobWaitFailedMessage('zotero-1', new Error('owner fence'))).toBe(
      'foreground wait failed (owner fence); the work continues as background job zotero-1',
    )
    // Both sentences name what the model can do, never the host's packages.
    expect(RUN_IN_BACKGROUND_DISABLED_MESSAGE).toContain('run the call in the foreground')
    expect(JOBS_UNAVAILABLE_MESSAGE).toContain('run the call in the foreground')
    expect(JOBS_UNAVAILABLE_MESSAGE).not.toContain('@deepseek-ai/')
  })

  describe('start', () => {
    it('throws if registry is unavailable', () => {
      const runner = new ZoteroJobRunner()
      expect(() =>
        runner.start({
          label: 'test export',
          exec: fakeExec(),
          run: async () => 'done',
        }),
      ).toThrow(JOBS_UNAVAILABLE_MESSAGE)
    })

    it('throws toolAborted if caller signal is already aborted', async () => {
      const jobs = await registryOf()
      const runner = new ZoteroJobRunner(jobs.registry)
      const controller = new AbortController()
      controller.abort()

      expect(() =>
        runner.start({
          label: 'test export',
          exec: fakeExec(controller.signal),
          run: async () => 'done',
        }),
      ).toThrowError(/tool call aborted/)
    })

    it('starts a background job, records progress and log channels, and completes with result', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)

      const { id } = runner.start({
        label: 'export items',
        exec: fakeExec(),
        run: async (_signal, onProgress, log) => {
          onProgress({ phase: 'export', message: 'exporting 1/2' })
          log('diagnostics row')
          return { exported: 2 }
        },
        renderResult: (value) => `exported ${value.exported} items`,
      })

      // The registry issues `<kind>-<short-uuid>`; the kind prefix is the
      // stable part a caller may rely on.
      expect(id.startsWith('zotero-')).toBe(true)
      const view = jobs.registry.get(id, ownerOf(true))
      expect(view.label).toBe('export items')
      expect(view.owner).toBe(OWNER)

      // The result is handed out by the first read after settlement.
      await jobs.settled(id, OWNER)
      const read = jobs.registry.read(id, ownerOf(true))
      expect(read.result).toBe('exported 2 items')
      // The runner writes one log line per progress event and per log call, in
      // that order.
      expect(read.chunks.map((chunk) => [chunk.channel, chunk.text])).toEqual([
        ['log', '[progress] exporting 1/2\n'],
        ['log', 'diagnostics row\n'],
      ])
      expect(read.job.status).toBe('completed')
      // The live progress line is the last progress the producer reported.
      expect(jobs.registry.get(id, ownerOf(true)).progress).toBeUndefined()
    })

    it('forwards the tool call identity, keeping a PTC sub-call paired with its root', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)

      const { id } = runner.start({
        label: 'ptc export',
        exec: { ...fakeExec(), callId: 'call-1:ptc:0' as never },
        run: async () => 'done',
      })

      await jobs.settled(id, OWNER)
      // The registry's own durable lifecycle record carries the paired identity:
      // a PTC sub-call must not look like a root call in the session log.
      const registered = jobs.eventsOf(OWNER).find((event) => event.type === 'job/registered')
      expect(registered?.data['toolCall']).toEqual({
        callId: 'call-1:ptc:0',
        rootCallId: 'call-1',
      })
    })

    it('settles as failed when run throws an error', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)

      const { id } = runner.start({
        label: 'export failing',
        exec: fakeExec(),
        run: async () => {
          throw new Error('disk full')
        },
      })

      const view = await jobs.settled(id, OWNER)
      expect(view.status).toBe('failed')
      expect(view.detail).toBe('disk full')
    })

    it('settles as killed when user cancels via cancel hook', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)

      let signalObserved: AbortSignal | undefined
      const { id } = runner.start({
        label: 'export cancelled',
        exec: fakeExec(),
        run: async (signal) => {
          signalObserved = signal
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
        },
      })

      // `kill` answers the contract's own words, not a projection.
      expect(jobs.registry.kill(id, ownerOf(true), 'user stopped')).toBe('requested')
      const view = await jobs.settled(id, OWNER)
      expect(view.status).toBe('killed')
      expect(view.detail).toContain('user stopped')
      expect(signalObserved?.aborted).toBe(true)
    })

    it('keeps an owned job invisible to another session’s caller', async () => {
      // Ownership is the registry's fence, not the runner's: a job started for
      // one session must not be readable or killable from another.
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)
      const { id } = runner.start({
        label: 'owned',
        exec: fakeExec(),
        run: async (signal) =>
          await new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          }),
      })
      expect(() => jobs.registry.get(id, SessionId('elsewhere'))).toThrow()
      expect(() => jobs.registry.kill(id, SessionId('elsewhere'))).toThrow()
      expect(jobs.registry.get(id, ownerOf(true)).owner).toBe(OWNER)
      // Release the live producer so teardown settles.
      jobs.registry.kill(id, ownerOf(true))
      await jobs.settled(id, OWNER)
    })

    it('keeps an explicit background job running when the caller aborts after publish', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const runner = new ZoteroJobRunner(jobs.registry)
      const controller = new AbortController()
      let taskSignal: AbortSignal | undefined
      const { id } = runner.start({
        label: 'caller aborted background survives',
        exec: fakeExec(controller.signal),
        run: async (signal) => {
          taskSignal = signal
          return await new Promise<string>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            setTimeout(() => resolve('rendered survived'), 20)
          })
        },
        renderResult: (value) => value,
      })

      controller.abort()
      expect(jobs.registry.get(id, ownerOf(true)).status).toBe('running')
      const view = await jobs.settled(id, OWNER)
      expect(view.status).toBe('completed')
      expect(jobs.registry.read(id, ownerOf(true)).result).toBe('rendered survived')
      expect(taskSignal?.aborted).toBe(false)
      expect(jobs.registry.list(ownerOf(true))).toHaveLength(1)
    })
  })

  describe('killAll', () => {
    it('kills every live job with its owner and forgets the settled one', async () => {
      const jobs = await registryOf()
      jobs.agentOf(OWNER)
      const kill = vi.spyOn(jobs.registry, 'kill')
      const runner = new ZoteroJobRunner(jobs.registry)

      const settled = runner.start({ label: 'settled', exec: fakeExec(), run: async () => 'done' })
      const live = runner.start({
        label: 'live',
        exec: fakeExec(undefined, false),
        // A producer that ignores its signal would leave the registry's
        // teardown waiting forever; the real one always observes it.
        run: async (signal) =>
          await new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          }),
      })
      await settled.done
      await Promise.resolve()

      runner.killAll('component disposed')
      expect(kill).toHaveBeenCalledTimes(1)
      expect(kill).toHaveBeenCalledWith(live.id, undefined, 'component disposed')
    })

    it('is a no-op without a registry', () => {
      const runner = new ZoteroJobRunner(undefined)
      expect(() => runner.killAll('nothing to stop')).not.toThrow()
    })
  })

  describe('executeWithJobs', () => {
    it('runs the plain synchronous arm with no-op channels when promotion is off', async () => {
      const runner = new ZoteroJobRunner()
      const seen: string[] = []
      const value = await executeWithJobs({
        runner,
        exec: fakeExec(),
        label: 'sync export',
        run: async (_signal, progress, log) => {
          progress({ phase: 'page', message: 'plain progress' })
          log('plain log')
          seen.push('ran')
          return 'done'
        },
        renderResult: (v: string) => v,
        runInBackground: false,
        policy: { enableRunInBackground: true, promoteOnTimeout: false, foregroundWaitMs: 4000 },
      })

      expect(value).toBe('done')
      expect(seen).toEqual(['ran'])
    })
  })
})
