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
import { withConnectivityAsk } from '../src/ask.js'
import {
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_RUNNING,
  ZOTERO_TIMEOUT,
  ZoteroError,
  type ZoteroErrorCode,
} from '../src/errors.js'

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

describe('withConnectivityAsk passthrough', () => {
  it('returns the request result without asking when the request succeeds', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    await expect(withConnectivityAsk(ctx, exec, async () => 'ok')).resolves.toBe('ok')
    expect(calls).toEqual([])
  })

  it('rethrows non-Zotero failures without asking', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const boom = new Error('boom')
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(boom))).rejects.toBe(
      boom,
    )
    expect(calls).toEqual([])
  })

  it('rethrows non-connectivity Zotero failures without asking', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const notFound = zoteroError(ZOTERO_NOT_FOUND)
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(notFound))).rejects.toBe(
      notFound,
    )
    expect(calls).toEqual([])
  })

  it('rethrows the original error when no question service is composed', async () => {
    const notRunning = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(
      withConnectivityAsk(noQuestions, exec, async () => Promise.reject(notRunning)),
    ).rejects.toBe(notRunning)
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
      header: 'Zotero version too old',
      question:
        'The running Zotero does not speak local API version 3, which this plugin requires.',
      retryLabel: 'I upgraded Zotero, retry (Recommended)',
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
      await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(error))).rejects.toBe(
        error,
      )
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

  it('forwards the calling agent and signal with the question', async () => {
    const signal = new AbortController().signal
    const agent = { id: 'agent-1' } as unknown as NonNullable<ToolRunContext['agent']>
    const { ctx, calls } = fakeContext(() => retryAnswer('Retry (Recommended)'))
    const error = zoteroError(ZOTERO_TIMEOUT)
    await expect(
      withConnectivityAsk(ctx, { signal, agent }, async () => Promise.reject(error)),
    ).rejects.toBe(error)
    expect(calls[0]!.agent).toBe(agent)
    expect(calls[0]!.signal).toBe(signal)
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
    await expect(withConnectivityAsk(ctx, exec, run)).resolves.toBe('second attempt')
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
    await expect(withConnectivityAsk(ctx, exec, run)).rejects.toBe(error)
    expect(attempts).toBe(2)
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when the user aborts', async () => {
    const { ctx, calls } = fakeContext(() => retryAnswer('Abort this query'))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error on a custom answer that matches no option', async () => {
    const { ctx, calls } = fakeContext(() => ({
      answers: [{ id: 'zotero-failure', selected: [], custom: 'let me look' }],
    }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(calls).toHaveLength(1)
  })

  it('surfaces the original error when the answer carries no matching question id', async () => {
    const { ctx, calls } = fakeContext(() => ({ answers: [] }))
    const error = zoteroError(ZOTERO_NOT_RUNNING)
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(calls).toHaveLength(1)
  })
})

describe('withConnectivityAsk fail-closed degradation', () => {
  it('surfaces the original error when the question mechanism fails', async () => {
    const { ctx, calls } = fakeContext(() => undefined)
    const error = zoteroError(ZOTERO_TIMEOUT)
    await expect(withConnectivityAsk(ctx, exec, async () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(calls).toHaveLength(1)
  })

  it('preserves tool cancellation when the caller aborts while asking', async () => {
    const controller = new AbortController()
    controller.abort()
    const { ctx, calls } = fakeContext(() => undefined)
    const error = zoteroError(ZOTERO_TIMEOUT)
    let thrown: unknown
    try {
      await withConnectivityAsk(ctx, { signal: controller.signal }, async () =>
        Promise.reject(error),
      )
    } catch (caught) {
      thrown = caught
    }
    expect(thrown).toBeInstanceOf(HarnessError)
    expect((thrown as HarnessError).code).toBe(TOOL_ABORTED)
    expect(calls).toHaveLength(1)
  })
})
