/**
 * `ZoteroJobRunner.waitOrPromote`: the foreground wait, promotion, and the
 * terminal arms, against the real `LocalJobRegistry`.
 *
 * The wait arm is its own contract — a settled view, a promotion, or the
 * producer's own error — so it lives beside the start/kill spec rather than
 * stretching it past the size ratchet.
 * @module tests/unit/job-runner-wait
 */

import { describe, expect, it, vi } from 'vitest'
import { ZoteroJobRunner, jobPromotedMessage, jobWaitFailedMessage } from '../../src/job-runner.js'
import { ZOTERO_TIMEOUT, ZoteroError } from '../../src/errors.js'
import type { DiagnosticSink } from '../../src/diagnostics.js'
import { fakeExec, OWNER, ownerOf, registryOf } from '../helpers/job-runner-fixtures.js'

describe('ZoteroJobRunner.waitOrPromote', () => {
  it('runs synchronously in foreground when registry is unavailable', async () => {
    const runner = new ZoteroJobRunner()
    const seen: string[] = []
    const outcome = await runner.waitOrPromote(
      {
        label: 'export sync',
        exec: fakeExec(),
        run: async (_signal, progress, log) => {
          progress({ phase: 'page', message: 'sync progress' })
          log('sync log')
          seen.push('ran')
          return 'quick result'
        },
      },
      4000,
    )

    expect(outcome).toEqual({ kind: 'foreground', value: 'quick result' })
    expect(seen).toEqual(['ran'])
  })

  it('falls back to a foreground run when the registry refuses admission', async () => {
    const jobs = await registryOf()
    // The refusal the real registry raises when no controller serves the
    // owner is reproduced here by refusing the start outright, so the
    // runner's fallback arm is exercised without a second composition.
    vi.spyOn(jobs.registry, 'start').mockImplementation(() => {
      throw new Error('background jobs unavailable: no job controller serves this agent')
    })
    const logger: DiagnosticSink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const runner = new ZoteroJobRunner(jobs.registry, logger)
    const seen: string[] = []
    const outcome = await runner.waitOrPromote(
      {
        label: 'refused admission',
        exec: fakeExec(),
        run: async (_signal, progress, log) => {
          progress({ phase: 'page', message: 'fallback progress' })
          log('fallback log')
          seen.push('ran')
          return 'foreground fallback'
        },
      },
      4000,
    )

    expect(outcome).toEqual({ kind: 'foreground', value: 'foreground fallback' })
    expect(seen).toEqual(['ran'])
    expect(logger.warn).toHaveBeenCalledWith(
      'job.refused',
      expect.stringContaining(
        'job registration refused, running in the foreground: background jobs unavailable: no job controller serves this agent',
      ),
    )
  })

  it('throws toolAborted if caller signal is already aborted before waiting', async () => {
    const jobs = await registryOf()
    const runner = new ZoteroJobRunner(jobs.registry)
    const controller = new AbortController()
    controller.abort()

    await expect(
      runner.waitOrPromote(
        {
          label: 'already aborted',
          exec: fakeExec(controller.signal),
          run: async () => 'result',
        },
        4000,
      ),
    ).rejects.toThrowError(/tool call aborted/)
  })

  it('waits for stopping to become terminal before removing a cancelled foreground job', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)
    const controller = new AbortController()
    const pending = runner.waitOrPromote(
      {
        label: 'cancelled foreground',
        exec: fakeExec(controller.signal),
        run: async (signal) =>
          await new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          }),
      },
      1000,
    )
    setTimeout(() => controller.abort(), 0)

    await expect(pending).rejects.toThrowError(/tool call aborted/)
    // The runner removes the settled job; the real registry leaves nothing.
    await vi.waitFor(() => expect(jobs.registry.list(ownerOf(true))).toHaveLength(0))
  })

  it('settles within foreground wait and cleans up job from registry', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    const outcome = await runner.waitOrPromote(
      {
        label: 'fast export',
        exec: fakeExec(),
        run: async () => ({ count: 5 }),
      },
      1000,
    )

    expect(outcome).toEqual({ kind: 'foreground', value: { count: 5 } })
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(0)
  })

  it('promotes to background job when foreground wait expires', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    const outcome = await runner.waitOrPromote(
      {
        label: 'slow export',
        exec: fakeExec(),
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return 'eventual result'
        },
      },
      20,
    )

    expect(outcome.kind).toBe('promoted')
    if (outcome.kind !== 'promoted') throw new Error('unreachable')
    expect(outcome.jobId.startsWith('zotero-')).toBe(true)
    expect(outcome.timeoutMs).toBe(20)
    expect(outcome.message).toBe(jobPromotedMessage(outcome.jobId, 20))
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(1)
  })

  it('throws when the foreground job fails before timeout', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'failing export',
          exec: fakeExec(),
          run: async () => {
            throw new Error('network down')
          },
        },
        1000,
      ),
    ).rejects.toThrow('network down')
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(0)
  })

  it('rethrows the producer error itself, keeping its typed code', async () => {
    // The registry reports a terminal view as a string. Throwing a fresh
    // error from it would strip the code the model routes on, so the
    // foreground arm prefers the object the producer actually threw.
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'timed-out export',
          exec: fakeExec(),
          run: async () => {
            throw new ZoteroError('Zotero did not answer in time', ZOTERO_TIMEOUT)
          },
        },
        1000,
      ),
    ).rejects.toMatchObject({ name: 'ZoteroError', code: ZOTERO_TIMEOUT })
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(0)
  })

  it('falls back to the registry detail when the producer threw a non-Error', async () => {
    // The harness contains a producer that rejects with a non-Error; the
    // string detail is then the only fact left, and the arm must still fail.
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'odd export',
          exec: fakeExec(),
          run: async () => {
            throw 'plain string failure'
          },
        },
        1000,
      ),
    ).rejects.toThrow('plain string failure')
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(0)
  })

  it('hands back the job id when the registry wait fails without aborting', async () => {
    // A healthy in-flight operation must not be destroyed by a wait failure,
    // and the id must not be dropped: the model still needs a handle.
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    vi.spyOn(jobs.registry, 'wait').mockRejectedValue(new Error('owner fence'))
    const runner = new ZoteroJobRunner(jobs.registry)

    const outcome = await runner.waitOrPromote(
      {
        label: 'wait failed',
        exec: fakeExec(),
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'eventual'
        },
      },
      20,
    )

    expect(outcome.kind).toBe('promoted')
    if (outcome.kind !== 'promoted') throw new Error('unreachable')
    expect(outcome.jobId.startsWith('zotero-')).toBe(true)
    expect(outcome.message).toBe(jobWaitFailedMessage(outcome.jobId, new Error('owner fence')))
    expect(jobs.registry.list(ownerOf(true))).toHaveLength(1)
  })

  it('settles as failed when non-Error is thrown', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    const { id } = runner.start({
      label: 'string failure',
      exec: fakeExec(),
      run: async () => {
        throw 'plain string error'
      },
    })

    const view = await jobs.settled(id, OWNER)
    expect(view.status).toBe('failed')
    expect(view.detail).toBe('plain string error')
  })

  it('handles execution without agent and a log line that already ends in a newline', async () => {
    const jobs = await registryOf()
    const runner = new ZoteroJobRunner(jobs.registry)

    const { id } = runner.start({
      label: 'export items',
      exec: fakeExec(undefined, false),
      run: async (_signal, _progress, log) => {
        log('already with newline\n')
        return 'ok'
      },
    })

    // An unowned job is visible to every caller.
    expect(jobs.registry.get(id).owner).toBeUndefined()
    await jobs.settled(id)
    expect(jobs.registry.read(id).chunks.map((chunk) => [chunk.channel, chunk.text])).toEqual([
      ['log', 'already with newline\n'],
    ])
  })

  it('settles as killed with default reason when cancel has no arguments', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    const { id } = runner.start({
      label: 'default cancel',
      exec: fakeExec(),
      run: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
    })

    expect(jobs.registry.kill(id, ownerOf(true))).toBe('requested')
    const view = await jobs.settled(id, OWNER)
    expect(view.status).toBe('killed')
    expect(view.detail).toBe('Job cancelled by user')
  })

  it('settles as killed with the reason the contract carries', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const runner = new ZoteroJobRunner(jobs.registry)

    const { id } = runner.start({
      label: 'error cancel',
      exec: fakeExec(),
      run: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
    })

    expect(jobs.registry.kill(id, ownerOf(true), 'explicit error object')).toBe('requested')
    const view = await jobs.settled(id, OWNER)
    expect(view.status).toBe('killed')
    expect(view.detail).toContain('explicit error object')
  })

  it('promotes when job status is stopping', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const original = jobs.registry.wait.bind(jobs.registry)
    vi.spyOn(jobs.registry, 'wait').mockImplementation(async (id, timeoutMs, caller, signal) => {
      const view = await original(id, timeoutMs, caller, signal)
      return { ...view, status: 'stopping' }
    })
    const runner = new ZoteroJobRunner(jobs.registry)

    const outcome = await runner.waitOrPromote(
      {
        label: 'stopping test',
        exec: fakeExec(),
        run: async () => 'done',
      },
      1000,
    )

    expect(outcome.kind).toBe('promoted')
  })

  it('throws when the foreground job settles as killed before timeout', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const original = jobs.registry.wait.bind(jobs.registry)
    vi.spyOn(jobs.registry, 'wait').mockImplementation(async (id, timeoutMs, caller, signal) => {
      const view = await original(id, timeoutMs, caller, signal)
      return { ...view, status: 'killed', detail: 'remote kill' }
    })
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'killed export',
          exec: fakeExec(),
          run: async () => 'val',
        },
        1000,
      ),
    ).rejects.toThrow('Zotero operation cancelled: remote kill')
  })

  it('throws fallback error when failed without detail', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const original = jobs.registry.wait.bind(jobs.registry)
    vi.spyOn(jobs.registry, 'wait').mockImplementation(async (id, timeoutMs, caller, signal) => {
      const view = await original(id, timeoutMs, caller, signal)
      return { ...view, status: 'failed', detail: undefined }
    })
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'no detail fail',
          exec: fakeExec(),
          run: async () => 'val',
        },
        1000,
      ),
    ).rejects.toThrow('Zotero operation failed')
  })

  it('throws fallback error when killed without detail', async () => {
    const jobs = await registryOf()
    jobs.agentOf(OWNER)
    const original = jobs.registry.wait.bind(jobs.registry)
    vi.spyOn(jobs.registry, 'wait').mockImplementation(async (id, timeoutMs, caller, signal) => {
      const view = await original(id, timeoutMs, caller, signal)
      return { ...view, status: 'killed', detail: undefined }
    })
    const runner = new ZoteroJobRunner(jobs.registry)

    await expect(
      runner.waitOrPromote(
        {
          label: 'no detail kill',
          exec: fakeExec(),
          run: async () => 'val',
        },
        1000,
      ),
    ).rejects.toThrow('Zotero operation cancelled: cancelled')
  })
})
