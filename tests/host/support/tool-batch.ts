/**
 * Typed `ToolBatchResult` fixtures for host specs that stub `ctx.tools.execute`.
 *
 * The upstream contracts are a discriminated union: a success carries a
 * `value` and no `error`, a failure carries `error` and no `value`, every
 * content entry is a real `ContentBlock`, and a call id is branded. Specs pass
 * only the arm they vary instead of restating the whole batch behind
 * `as never`, which used to hide contract drift.
 * @module tests/host/support/tool-batch
 */
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  ToolBatchResult,
  ToolCallResult,
  ToolExecutionResult,
  ToolFailure,
} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  HARNESS_REFUSAL_TEMPLATES,
  type HarnessRefusalKind,
} from '../../../src/library-write-denial.js'

interface ToolBatchCommon {
  readonly callId?: string
  readonly meta?: JsonValue
  readonly content?: readonly ContentBlock[]
}

/** The two real execution arms, with only their own fields available. */
export type ToolBatchResultInit = ToolBatchCommon &
  (
    | { readonly isError: false; readonly value?: JsonValue }
    | { readonly isError: true; readonly error: ToolFailure }
  )

/** One plain text block, the only kind the library-write gateway projects. */
export function textContent(text: string): ContentBlock {
  return { type: 'text', text }
}

/** One legal non-text block, so specs can assert that non-text content is filtered. */
export function nonTextContent(text = 'internal reasoning'): ContentBlock {
  return { type: 'reasoning', text }
}

/** Build one fully typed execution result, before it is wrapped in a batch. */
export function toolExecutionResult(init: ToolBatchResultInit): ToolExecutionResult {
  const content = [...(init.content ?? [])]
  const common = init.meta === undefined ? {} : { meta: init.meta }
  return init.isError
    ? { isError: true, error: init.error, content, ...common }
    : { isError: false, value: init.value ?? null, content, ...common }
}

/** Build a model-ordered, one-call batch with a branded call id. */
export function toolBatchResult(init: ToolBatchResultInit): ToolBatchResult {
  const one: ToolCallResult = {
    callId: ToolCallId(init.callId ?? 'call-1'),
    result: toolExecutionResult(init),
  }
  return { results: [one], additionalContexts: [], concluded: false }
}

/** Interpolate one documented harness refusal sentence for a given tool. */
export function harnessRefusal(kind: HarnessRefusalKind, toolName: string): string {
  return HARNESS_REFUSAL_TEMPLATES[kind].replace('$TOOL', toolName)
}
