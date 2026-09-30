/**
 * Unit tests for `src/job-runner.ts` (long-running jobs integration).
 * @module tests/unit/job-runner
 */

import { describe, expect, it, vi } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  ZoteroJobRunner,
  JOBS_UNAVAILABLE_MESSAGE,
  RUN_IN_BACKGROUND_DISABLED_MESSAGE,
  jobStartedMessage,
  jobPromotedMessage,
  jobWaitFailedMessage,
} from '../../src/job-runner.js'
import { projectJobView, TestJobRegistry } from '../helpers/fake-jobs.js'

function fakeExec(
  signal: AbortSignal = new AbortController().signal,
  hasAgent = true,
): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 'token-1' as never,
    name: 'test_tool',
    arguments: {},
    signal,
    ...(hasAgent ? { agent: { id: 'session-123' as SessionId } as never } : {}),
  }
}

describe('ZoteroJobRunner', () => {
  it('reports availability based on registry presence', () => {
    expect(new ZoteroJobRunner().isAvailable).toBe(false)
    expect(new ZoteroJobRunner(new TestJobRegistry() as unknown as JobRegistry).isAvailable).toBe(
      true,
    )
  })

  it('formats job started and promoted messages by exact identity', () => {
    expect(jobStartedMessage('zotero-1')).toBe('started background job zotero-1')
    expect(jobPromotedMessage('zotero-1', 4000)).toBe(
      'operation timed out after 4000ms and was promoted to background job zotero-1',
    )
    expect(jobWaitFailedMessage('zotero-1', new Error('owner fence'))).toBe(
      'foreground wait failed (owner fence); the work continues as background job zotero-1',
    )
    expect(RUN_IN_BACKGROUND_DISABLED_MESSAGE).toContain('enableRunInBackground: false')
    expect(JOBS_UNAVAILABLE_MESSAGE).toContain('background jobs unavailable')
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

    it('throws toolAborted if caller signal is already aborted', () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
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
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

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

      expect(id).toBe('zotero-1')
      const entry = registry.jobs.get(id)!
      expect(entry).toBeDefined()
      expect(entry.spec.label).toBe('export items')
      expect(entry.spec.owner).toBe('session-123')

      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('completed')
      expect(outcome.result).toBe('exported 2 items')
      expect(entry.progressEvents).toEqual(['exporting 1/2'])
      expect(entry.appends).toEqual([
        { text: '[progress] exporting 1/2\n', channel: 'log' },
        { text: 'diagnostics row\n', channel: 'log' },
      ])
    })

    it('settles as failed when run throws an error', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'export failing',
        exec: fakeExec(),
        run: async () => {
          throw new Error('disk full')
        },
      })

      const entry = registry.jobs.get(id)!
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toBe('disk full')
    })

    it('settles as killed when user cancels via cancel hook', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

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

      const entry = registry.jobs.get(id)!
      entry.hooks.cancel?.('user stopped')
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('killed')
      expect(signalObserved?.aborted).toBe(true)
    })

    it('cancels an explicit background job when the caller aborts', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const controller = new AbortController()
      const { id } = runner.start(
        {
          label: 'caller cancelled background',
          exec: fakeExec(controller.signal),
          run: async (signal) =>
            await new Promise<string>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            }),
        },
        { cancelOnCallerAbort: true },
      )

      controller.abort()
      const outcome = await registry.jobs.get(id)!.hooks.done
      expect(outcome.status).toBe('killed')
      expect(outcome.detail).toBe('tool call aborted')
    })
  })

  describe('waitOrPromote', () => {
    it('runs synchronously in foreground when registry is unavailable', async () => {
      const runner = new ZoteroJobRunner()
      const outcome = await runner.waitOrPromote(
        {
          label: 'export sync',
          exec: fakeExec(),
          run: async () => 'quick result',
        },
        4000,
      )

      expect(outcome).toEqual({ kind: 'foreground', value: 'quick result' })
    })

    it('falls back to a foreground run when the registry refuses admission', async () => {
      const registry = new TestJobRegistry()
      registry.start = (() => {
        throw new Error('background jobs unavailable: no job controller serves this agent')
      }) as typeof registry.start
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const outcome = await runner.waitOrPromote(
        {
          label: 'refused admission',
          exec: fakeExec(),
          run: async () => 'foreground fallback',
        },
        4000,
      )

      expect(outcome).toEqual({ kind: 'foreground', value: 'foreground fallback' })
    })

    it('throws toolAborted if caller signal is already aborted before waiting', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
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
      const registry = new TestJobRegistry()
      const originalRemove = registry.remove.bind(registry)
      registry.kill = ((id, caller, reason) => {
        const job = registry.jobs.get(id)!
        job.hooks.cancel?.(reason)
        job.status = 'stopping'
        job.detail = reason
        return projectJobView(id, job)
      }) as typeof registry.kill
      registry.remove = ((id, caller) => {
        if (registry.jobs.get(id)?.status === 'stopping') {
          throw new Error(`job ${id} is still stopping`)
        }
        originalRemove(id, caller)
      }) as typeof registry.remove

      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
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
      await vi.waitFor(() => expect(registry.jobs.size).toBe(0))
    })

    it('settles within foreground wait and cleans up job from registry', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const outcome = await runner.waitOrPromote(
        {
          label: 'fast export',
          exec: fakeExec(),
          run: async () => ({ count: 5 }),
        },
        1000,
      )

      expect(outcome).toEqual({ kind: 'foreground', value: { count: 5 } })
      expect(registry.jobs.size).toBe(0)
    })

    it('promotes to background job when foreground wait expires', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

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
      if (outcome.kind === 'promoted') {
        expect(outcome.jobId).toBe('zotero-1')
        expect(outcome.timeoutMs).toBe(20)
        expect(outcome.message).toBe(jobPromotedMessage('zotero-1', 20))
      }
      expect(registry.jobs.size).toBe(1)
    })

    it('throws when the foreground job fails before timeout', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

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
      expect(registry.jobs.size).toBe(0)
    })

    it('hands back the job id when the registry wait fails without aborting', async () => {
      // A healthy in-flight operation must not be destroyed by a wait failure,
      // and the id must not be dropped: the model still needs a handle.
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      registry.wait = async () => {
        throw new Error('owner fence')
      }

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
      if (outcome.kind === 'promoted') {
        expect(outcome.jobId).toBe('zotero-1')
        expect(outcome.message).toBe(jobWaitFailedMessage('zotero-1', new Error('owner fence')))
      }
      expect(registry.jobs.size).toBe(1)
    })

    it('settles as failed when non-Error is thrown', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'string failure',
        exec: fakeExec(),
        run: async () => {
          throw 'plain string error'
        },
      })

      const entry = registry.jobs.get(id)!
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toBe('plain string error')
    })

    it('passes outputLimitBytes and handles execution without agent and newline in log', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'export items',
        exec: fakeExec(undefined, false),
        outputLimitBytes: 1024,
        run: async (_signal, _progress, log) => {
          log('already with newline\n')
          return 'ok'
        },
      })

      const entry = registry.jobs.get(id)!
      expect(entry.spec.outputLimitBytes).toBe(1024)
      expect(entry.spec.owner).toBeUndefined()
      await entry.hooks.done
      expect(entry.appends).toEqual([{ text: 'already with newline\n', channel: 'log' }])
    })

    it('settles as killed with default reason when cancel has no arguments', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'default cancel',
        exec: fakeExec(),
        run: async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
        },
      })

      const entry = registry.jobs.get(id)!
      entry.hooks.cancel?.()
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('killed')
      expect(outcome.detail).toBe('Job cancelled by user')
    })

    it('settles as killed with Error instance as reason', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'error cancel',
        exec: fakeExec(),
        run: async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
        },
      })

      const entry = registry.jobs.get(id)!
      entry.hooks.cancel?.(new Error('explicit error object') as never)
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('killed')
      expect(outcome.detail).toBe('explicit error object')
    })

    it('settles as killed with non-string non-error reason', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)

      const { id } = runner.start({
        label: 'number cancel',
        exec: fakeExec(),
        run: async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
        },
      })

      const entry = registry.jobs.get(id)!
      entry.hooks.cancel?.(12345 as never)
      const outcome = await entry.hooks.done
      expect(outcome.status).toBe('killed')
      expect(outcome.detail).toBe('cancelled')
    })

    it('promotes when job status is stopping', async () => {
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const originalWait = registry.wait.bind(registry)
      registry.wait = async (id, timeoutMs, caller, signal) => {
        const view = await originalWait(id, timeoutMs, caller, signal)
        return { ...view, status: 'stopping' }
      }

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
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const originalWait = registry.wait.bind(registry)
      registry.wait = async (id, timeoutMs, caller, signal) => {
        const view = await originalWait(id, timeoutMs, caller, signal)
        return { ...view, status: 'killed', detail: 'remote kill' }
      }

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
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const originalWait = registry.wait.bind(registry)
      registry.wait = async (id, timeoutMs, caller, signal) => {
        const view = await originalWait(id, timeoutMs, caller, signal)
        return { ...view, status: 'failed', detail: undefined }
      }

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
      const registry = new TestJobRegistry()
      const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
      const originalWait = registry.wait.bind(registry)
      registry.wait = async (id, timeoutMs, caller, signal) => {
        const view = await originalWait(id, timeoutMs, caller, signal)
        return { ...view, status: 'killed', detail: undefined }
      }

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
})
