/**
 * Interactive recovery for Zotero connectivity failures.
 *
 * When a request-driven tool call fails because Zotero cannot serve it
 * (not running, local API disabled, unsupported API version, timeout),
 * the caller is asked how to proceed through the `userQuestions` seam,
 * with the recommended action offered first. The ask happens only inside
 * a tool call that actually attempted a Zotero request — loading the
 * plugin never probes, and a tool that was never called never asks.
 * Everything here fails closed: an absent question service, a failed
 * question, or a non-retry answer all surface the original typed
 * `ZoteroError`, so a broken question mechanism can never mask a broken
 * Zotero connection, and a retry is attempted at most once.
 * @module dsh-zotero/ask
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
  UserQuestionService,
} from '@deepseek-ai/dsh-user-questions'
import {
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_RUNNING,
  ZOTERO_TIMEOUT,
  ZoteroError,
} from './errors.js'

/** The connectivity failure codes that warrant asking the user how to proceed. */
export const ASK_WORTHY_CODES = [
  ZOTERO_NOT_RUNNING,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_TIMEOUT,
] as const

export type AskWorthyCode = (typeof ASK_WORTHY_CODES)[number]

/** The parts of a tool execution `withConnectivityAsk` needs. */
export interface ConnectivityAskExec {
  readonly signal?: AbortSignal
  readonly agent?: unknown
}

/** One connectivity failure rendered as a question card with a recommended option. */
interface FailureSpec {
  readonly header: string
  readonly question: string
  readonly detail: string
  readonly retryLabel: string
  readonly retryDescription: string
  readonly abortLabel: string
  readonly abortDescription: string
}

const ABORT_LABEL = '放弃这次查询'
const ABORT_DESCRIPTION = '停止本次操作，之后可再让我重试。'
const RETRY_DESCRIPTION = '按原参数重新执行这次查询。'

const FAILURE_SPECS: Record<AskWorthyCode, FailureSpec> = {
  [ZOTERO_NOT_RUNNING]: {
    header: 'Zotero 未运行',
    question: 'Zotero 没有在运行，无法读取你的文献库。怎么处理？',
    detail:
      '请启动 Zotero，并确认 Settings → Advanced 里已勾选 "Allow other applications on this computer to communicate with Zotero"。',
    retryLabel: '我已启动 Zotero，重试 (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_API_DISABLED]: {
    header: 'Zotero 本地 API 未开启',
    question: 'Zotero 正在运行，但拒绝了本地 API 请求（403）。',
    detail:
      '请在 Zotero 的 Settings → Advanced 中勾选 "Allow other applications on this computer to communicate with Zotero"。',
    retryLabel: '我已开启本地 API，重试 (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_API_VERSION]: {
    header: 'Zotero 版本过旧',
    question: '当前 Zotero 的本地 API 版本不是插件要求的版本 3。',
    detail: '请升级 Zotero 到支持本地 API v3 的版本。',
    retryLabel: '我已升级 Zotero，重试 (Recommended)',
    retryDescription: RETRY_DESCRIPTION,
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
  [ZOTERO_TIMEOUT]: {
    header: 'Zotero 响应超时',
    question: 'Zotero 在超时时间内没有响应（可能正在为大型文献库建立索引）。',
    detail: '本次请求在配置的超时时间后失败。',
    retryLabel: '重试 (Recommended)',
    retryDescription: '再次执行同一请求。',
    abortLabel: ABORT_LABEL,
    abortDescription: ABORT_DESCRIPTION,
  },
}

function isAskWorthyCode(code: string): code is AskWorthyCode {
  return (ASK_WORTHY_CODES as readonly string[]).includes(code)
}

function questionOf(spec: FailureSpec): AskUserQuestionItem {
  return {
    id: 'zotero-failure',
    question: spec.question,
    header: spec.header,
    detail: spec.detail,
    options: [
      { label: spec.retryLabel, description: spec.retryDescription },
      { label: spec.abortLabel, description: spec.abortDescription },
    ],
  }
}

/**
 * Run one Zotero request; on a connectivity failure, ask the user how to
 * proceed and retry at most once when they choose the recommended action.
 * @param ctx - the plugin context; the question service is looked up
 *   optionally, so headless compositions skip the ask.
 * @param exec - the tool execution (signal and agent) the failure belongs to.
 * @param run - the request to attempt; must be re-runnable with identical
 *   arguments, because the retry path calls it a second time.
 * @returns the request result, or throws the original `ZoteroError` when
 *   the failure is not ask-worthy, no question service exists, the user
 *   does not choose to retry, the question itself fails, or the retry
 *   fails again.
 */
export async function withConnectivityAsk<T>(
  ctx: Context,
  exec: ConnectivityAskExec,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof ZoteroError) || !isAskWorthyCode(error.code)) throw error
    const questions = ctx.get('userQuestions') as UserQuestionService | undefined
    if (questions === undefined) throw error
    const spec = FAILURE_SPECS[error.code]
    let answer: AskUserQuestionAnswer
    try {
      const request: AskUserQuestionRequest = {
        questions: [questionOf(spec)],
        ...(exec.agent !== undefined
          ? { agent: exec.agent as AskUserQuestionRequest['agent'] }
          : {}),
        signal: exec.signal,
      }
      answer = await questions.ask(request)
    } catch {
      // A failed question (no provider, aborted ask, delegated caller) must
      // never mask the underlying connectivity failure.
      if (exec.signal?.aborted) throw new HarnessError('tool call aborted', TOOL_ABORTED)
      throw error
    }
    const answerItem = answer.answers.find((item) => item.id === 'zotero-failure')
    const selected = answerItem?.selected ?? []
    if (!selected.includes(spec.retryLabel)) throw error
    // Outside the catch: a second failure propagates as-is, never re-asking.
    return await run()
  }
}
