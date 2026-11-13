/**
 * `ZoteroJobRunner.waitOrPromote`'s cancellation and kill arms: the caller
 * abort, a job already stopping, and the terminal killed/failed fallbacks,
 * against the real `LocalJobRegistry`.
 * @module tests/unit/job-runner-cancel
 */

import { describe, expect, it, vi } from 'vitest'
import { ZoteroJobRunner } from '../../src/job-runner.js'
import { fakeExec, OWNER, ownerOf, registryOf } from '../helpers/job-runner-fixtures.js'

describe('ZoteroJobRunner.waitOrPromote cancellation', () => {
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
    ).rejects.toMatchObject({
      code: 'ABORTED',
      name: 'AbortError',
      message: 'Zotero operation cancelled: remote kill',
    })
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
    ).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'Zotero operation cancelled: cancelled',
    })
  })
})
