/**
 * Unit tests for the connectivity-failure question bridge (`src/ask.ts`).
 *
 * The wrapper is exercised with a fake `userQuestions` service so every
 * branch — passthrough, question content, retry-once, abort, and
 * fail-closed degradation — is driven without the real UI provider.
 * @module tests/ask
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { describe, expect, it } from 'vitest'
import { ConnectivityRecovery, withConnectivityAsk } from '../../src/ask.js'
import {
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_RUNNING,
  ZOTERO_TIMEOUT,
  ZoteroError,
  type ZoteroErrorCode,
} from '../../src/errors.js'

function zoteroError(code: ZoteroErrorCode): ZoteroError {
  return new ZoteroError(`failure ${code}`, code)
}

/** A context whose `userQuestions` is a scripted stub recording every ask. */
function fakeContext(
  handler: (request: AskUserQuestionRequest) => AskUserQuestionAnswer | undefined,
): { ctx: Context; calls: AskUserQuestionRequest[] } {
  const calls: AskUserQuestionRequest[] = []
  const service = {
    ask: async (request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> => {
      calls.push(request)
      const answer = handler(request)
      if (answer === undefined) throw new Error('test: no question provider')
      return answer
    },
  }
  return {
    calls,
    ctx: {
      get: (key: string) => (key === 'userQuestions' ? service : undefined),
    } as unknown as Context,
  }
}

/** A context with no question service at all — the headless composition. */
function headlessContext(): Context {
  return { get: () => undefined } as unknown as Context
}

function retryAnswer(label: string): AskUserQuestionAnswer {
  return { answers: [{ id: 'zotero-failure', selected: [label] }] }
}

const noQuestions: Context = headlessContext()
const exec = { signal: new AbortController().signal }

/**
 * A fresh recovery gate per call: the gate is what makes concurrent failures
 * share one question, so each unit case here starts with none in flight. The
 * coalescing cases below drive one gate from several callers on purpose.
 */
function ask<T>(ctx: Context, run: () => Promise<T>): Promise<T> {
  return withConnectivityAsk(ctx, new ConnectivityRecovery(), exec, run)
}

describe('withConnectivityAsk passthrough', () => {
  it('returns the request result without asking when the request succeeds', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    await expect(ask(ctx, async () => 'ok')).resolves.toBe('ok')
    expect(calls).toEqual([])
  })

  it('rethrows non-Zotero failures without asking', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const boom = new Error('boom')
    await expect(ask(ctx, async () => Promise.reject(boom))).rejects.toBe(boom)
    expect(calls).toEqual([])
  })

  it('rethrows non-connectivity Zotero failures without asking', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const notFound = zoteroError(ZOTERO_NOT_FOUND)
    await expect(ask(ctx, async () => Promise.reject(notFound))).rejects.toBe(notFound)
    expect(calls).toEqual([])
  })

  it('rethrows the original error when no question service is composed', async () => {
    const notRunning = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(noQuestions, async () => Promise.reject(notRunning))).rejects.toBe(notRunning)
  })
})

describe('withConnectivityAsk question content', () => {
  const cases: { code: ZoteroErrorCode; header: string; question: string; retryLabel: string }[] = [
    {
      code: ZOTERO_NOT_RUNNING,
      header: 'Zotero is not running',
      question: 'Zotero is not running, so I cannot read your library. What should I do?',
      retryLabel: 'I started Zotero, retry (Recommended)',
    },
    {
      code: ZOTERO_API_DISABLED,
      header: 'Zotero local API is disabled',
      question: 'Zotero is running but rejected the local API request (403).',
      retryLabel: 'I enabled the local API, retry (Recommended)',
    },
    {
      code: ZOTERO_API_VERSION,
      header: 'Zotero and this plugin share no API version',
      question:
        'The running Zotero does not implement local API version 3, which this plugin requires.',
      retryLabel: 'I fixed the version, retry (Recommended)',
    },
    {
      code: ZOTERO_TIMEOUT,
      header: 'Zotero timed out',
      question: 'Zotero did not respond within the timeout (it may be indexing a large library).',
      retryLabel: 'Retry (Recommended)',
    },
  ]

  for (const { code, header, question, retryLabel } of cases) {
    it(`asks for ${code} with the recommended action first`, async () => {
      const { ctx, calls } = fakeContext(() => retryAnswer(retryLabel))
      const error = zoteroError(code)
      // The retry fails again, so the original error surfaces after one ask.
      await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
      expect(calls).toHaveLength(1)
      const request = calls[0]!
      expect(request.questions).toHaveLength(1)
      const questionItem = request.questions[0]!
      expect(questionItem.id).toBe('zotero-failure')
      expect(questionItem.header).toBe(header)
      expect(questionItem.question).toBe(question)
      expect(questionItem.detail).not.toBe('')
      expect(questionItem.options).toHaveLength(2)
      expect(questionItem.options![0]!.label).toBe(retryLabel)
      expect(questionItem.options![1]!.label).toBe('Abort this query')
    })
  }

  it('forwards the calling agent and a gate-owned signal with the question', async () => {
    const signal = new AbortController().signal
    const agent = { id: 'agent-1' } as unknown as NonNullable<ToolRunContext['agent']>
    const { ctx, calls } = fakeContext(() => retryAnswer('Retry (Recommended)'))
    const error = zoteroError(ZOTERO_TIMEOUT)
    await expect(
      withConnectivityAsk(ctx, new ConnectivityRecovery(), { signal, agent }, async () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error)
    expect(calls[0]!.agent).toBe(agent)
    // The shared question is owned by the gate, not by any one caller: a
    // waiter's abort must not cancel a question other waiters still need.
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0]!.signal).not.toBe(signal)
  })
})

describe('withConnectivityAsk retry semantics', () => {
  it('re-runs the request once with identical arguments when the user retries', async () => {
    const { ctx, calls } = fakeContext(() => retryAnswer('Retry (Recommended)'))
    const argumentsSeen: string[] = []
    const run = async (): Promise<string> => {
      argumentsSeen.push('same')
      if (argumentsSeen.length === 1) throw zoteroError(ZOTERO_TIMEOUT)
      return 'second attempt'
    }
    await expect(ask(ctx, run)).resolves.toBe('second attempt')
    expect(argumentsSeen).toEqual(['same', 'same'])
    expect(calls).toHaveLength(1)
  })

  it('surfaces the second failure without asking again', async () => {
    const { ctx, calls } = fakeContext(() => retryAnswer('I started Zotero, retry (Recommended)'))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    let attempts = 0
    const run = async (): Promise<never> => {
      attempts += 1
      throw error
    }
    await expect(ask(ctx, run)).rejects.toBe(error)
    expect(attempts).toBe(2)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when the user aborts', async () => {
    const { ctx, calls } = fakeContext(() => retryAnswer('Abort this query'))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error on a custom answer that matches no option', async () => {
    const { ctx, calls } = fakeContext(() => ({
      answers: [{ id: 'zotero-failure', selected: [], custom: 'let me look' }],
    }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when the user chose retry but also provided custom feedback', async () => {
    const { ctx, calls } = fakeContext(() => ({
      answers: [
        {
          id: 'zotero-failure',
          selected: ['I started Zotero, retry (Recommended)'],
          custom: 'not sure',
        },
      ],
    }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when multiple options were selected', async () => {
    const { ctx, calls } = fakeContext(() => ({
      answers: [
        {
          id: 'zotero-failure',
          selected: ['I started Zotero, retry (Recommended)', 'Abort this query'],
        },
      ],
    }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when the answer carries no matching question id', async () => {
    const { ctx, calls } = fakeContext(() => ({ answers: [] }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })
})

describe('withConnectivityAsk fail-closed degradation', () => {
  it('surfaces the original error when the question mechanism fails', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const error = zoteroError(ZOTERO_TIMEOUT)
    await expect(ask(ctx, async () => Promise.reject(error))).rejects.toBe(error)
    expect(calls).toHaveLength(1)
  })

  it('preserves tool cancellation when the caller aborts while asking', async () => {
    const controller = new AbortController()
    controller.abort()
    const { ctx, calls } = fakeContext(() => undefined)
    const error = zoteroError(ZOTERO_TIMEOUT)
    let thrown: unknown
    try {
      await withConnectivityAsk(
        ctx,
        new ConnectivityRecovery(),
        { signal: controller.signal },
        async () => Promise.reject(error),
      )
    } catch (caught) {
      thrown = caught
    }
    expect(thrown).toBeInstanceOf(HarnessError)
    expect((thrown as HarnessError).code).toBe(TOOL_ABORTED)
    expect(calls).toHaveLength(1)
  })
})

describe('concurrent failures share one recovery question', () => {
  /** A question service that only settles when the test releases it. */
  function gatedContext(): {
    ctx: Context
    calls: AskUserQuestionRequest[]
    release: (selected: string[]) => void
  } {
    const calls: AskUserQuestionRequest[] = []
    let release: ((selected: string[]) => void) | undefined
    const answer = new Promise<AskUserQuestionAnswer>((resolve) => {
      release = (selected) => resolve({ answers: [{ id: 'zotero-failure', selected }] })
    })
    const service = {
      ask: async (request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> => {
        calls.push(request)
        return await answer
      },
    }
    return {
      calls,
      ctx: {
        get: (key: string) => (key === 'userQuestions' ? service : undefined),
      } as unknown as Context,
      release: (selected) => release!(selected),
    }
  }

  it('asks once for parallel calls that failed the same way, and retries each', async () => {
    const recovery = new ConnectivityRecovery()
    const { ctx, calls, release } = gatedContext()
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    let attempts = 0
    const run = async (): Promise<string> => {
      attempts += 1
      // Every attempt fails: the retry afterwards is what the assertions see.
      throw error
    }
    const first = withConnectivityAsk(ctx, recovery, exec, run)
    const second = withConnectivityAsk(ctx, recovery, exec, run)
    const third = withConnectivityAsk(ctx, recovery, exec, run)
    await Promise.resolve()
    // Three failures, one card: the other two wait on the same answer.
    expect(calls).toHaveLength(1)
    release(['I started Zotero, retry (Recommended)'])
    for (const pending of [first, second, third]) {
      await expect(pending).rejects.toBe(error)
    }
    // Each caller retried its own request exactly once.
    expect(attempts).toBe(6)
  })

  it('keeps the shared question alive when one waiter aborts', async () => {
    const recovery = new ConnectivityRecovery()
    const { ctx, calls, release } = gatedContext()
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    const aborted = new AbortController()
    const live = new AbortController()
    const first = withConnectivityAsk(ctx, recovery, { signal: aborted.signal }, async () =>
      Promise.reject(error),
    )
    const second = withConnectivityAsk(ctx, recovery, { signal: live.signal }, async () =>
      Promise.reject(error),
    )
    // Both callers must reach the shared ask before either aborts.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    // The first waiter cancels; the shared question must survive for the second.
    aborted.abort()
    await expect(first).rejects.toMatchObject({ name: 'HarnessError' })
    // The shared question is still open (one card, not a cancelled ask).
    expect(calls).toHaveLength(1)
    release(['I started Zotero, retry (Recommended)'])
    await expect(second).rejects.toBe(error)
  })

  it('gives a different failure kind its own question', async () => {
    const recovery = new ConnectivityRecovery()
    const { ctx, calls, release } = gatedContext()
    const notRunning = withConnectivityAsk(ctx, recovery, exec, async () => {
      throw zoteroError(ZOTERO_NOT_RUNNING)
    })
    const timedOut = withConnectivityAsk(ctx, recovery, exec, async () => {
      throw zoteroError(ZOTERO_TIMEOUT)
    })
    await Promise.resolve()
    expect(calls.map((call) => call.questions[0]!.header)).toEqual([
      'Zotero is not running',
      'Zotero timed out',
    ])
    release(['Abort this query'])
    await expect(notRunning).rejects.toBeInstanceOf(ZoteroError)
    await expect(timedOut).rejects.toBeInstanceOf(ZoteroError)
  })

  it('asks again for a failure that arrives after the question settled', async () => {
    const recovery = new ConnectivityRecovery()
    const answered = fakeContext((request) => retryAnswer('I started Zotero, retry (Recommended)'))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(
      withConnectivityAsk(answered.ctx, recovery, exec, async () => {
        throw error
      }),
    ).rejects.toBe(error)
    await expect(
      withConnectivityAsk(answered.ctx, recovery, exec, async () => {
        throw error
      }),
    ).rejects.toBe(error)
    // A stale answer is never reused: the second failure asked on its own.
    expect(answered.calls).toHaveLength(2)
  })
})

describe('agent partitioning and delegation', () => {
  it('throws immediately without asking when the agent is a delegated child agent', async () => {
    const rootAgent = { id: 'root-agent' } as any
    const childAgent = { id: 'child-agent' } as any
    const agentsService = {
      roots: () => [rootAgent],
    }
    const calls: any[] = []
    const ctx = {
      get: (key: string) => {
        if (key === 'agents') return agentsService
        if (key === 'userQuestions') {
          return {
            ask: async (req: any) => {
              calls.push(req)
              return { answers: [] }
            },
          }
        }
        return undefined
      },
    } as unknown as Context

    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(
      withConnectivityAsk(
        ctx,
        new ConnectivityRecovery(),
        { signal: new AbortController().signal, agent: childAgent },
        async () => {
          throw error
        },
      ),
    ).rejects.toBe(error)
    expect(calls).toHaveLength(0)
  })

  it('partitions shared questions by agent identity so distinct agents get separate questions', async () => {
    const recovery = new ConnectivityRecovery()
    const calls: AskUserQuestionRequest[] = []
    let releaseA: ((selected: string[]) => void) | undefined
    let releaseB: ((selected: string[]) => void) | undefined
    const answerA = new Promise<AskUserQuestionAnswer>((resolve) => {
      releaseA = (selected) => resolve({ answers: [{ id: 'zotero-failure', selected }] })
    })
    const answerB = new Promise<AskUserQuestionAnswer>((resolve) => {
      releaseB = (selected) => resolve({ answers: [{ id: 'zotero-failure', selected }] })
    })

    const ctx = {
      get: (key: string) =>
        key === 'userQuestions'
          ? {
              ask: async (req: AskUserQuestionRequest) => {
                calls.push(req)
                return req.agent?.id === 'agent-A' ? await answerA : await answerB
              },
            }
          : undefined,
    } as unknown as Context

    const agentA = { id: 'agent-A' } as any
    const agentB = { id: 'agent-B' } as any
    const error = zoteroError(ZOTERO_NOT_RUNNING)

    const first = withConnectivityAsk(
      ctx,
      recovery,
      { signal: new AbortController().signal, agent: agentA },
      async () => {
        throw error
      },
    )
    const second = withConnectivityAsk(
      ctx,
      recovery,
      { signal: new AbortController().signal, agent: agentB },
      async () => {
        throw error
      },
    )
    await Promise.resolve()

    expect(calls).toHaveLength(2)
    releaseA!(['Abort this query'])
    releaseB!(['Abort this query'])
    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
  })
})

describe('recovery disposal', () => {
  it('aborts in-flight questions when disposed', async () => {
    const recovery = new ConnectivityRecovery()
    let aborted = false
    const questions = {
      ask: (req: any) =>
        new Promise((_resolve, reject) => {
          req.signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        }),
    }
    const ctx = {
      get: (key: string) => (key === 'userQuestions' ? questions : undefined),
    } as unknown as Context
    const error = zoteroError(ZOTERO_NOT_RUNNING)

    const promise = withConnectivityAsk(ctx, recovery, exec, async () => {
      throw error
    })
    await Promise.resolve()

    recovery.dispose()
    expect(aborted).toBe(true)
    await expect(promise).rejects.toBe(error)
  })
})
