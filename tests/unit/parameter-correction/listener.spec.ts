/** The post-execute listener: append only where the hint is safe. */
import { describe, expect, it, vi } from 'vitest'
import {
  defineTool,
  type PostToolDecision,
  type ToolExecution,
  type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import {
  parameterCorrectionHint,
  parameterCorrectionListener,
  type ParameterCorrectionLookup,
} from '../../../src/parameter-correction.ts'

const definition = defineTool({
  name: 'probe',
  description: 'Parameter correction listener probe.',
  parameters: { ref: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: async () => 'ok',
})

const invalidArguments: ToolExecutionResult = {
  isError: true,
  error: {
    message: 'invalid arguments',
    info: { name: 'ToolArgsError', code: 'INVALID_ARGS' },
  },
  content: [{ type: 'text', text: 'Error: invalid arguments' }],
}

/** The listener reads only these fields; the cast keeps the unit fixture small. */
const execution = (args: unknown): ToolExecution =>
  ({ name: 'probe', arguments: args }) as ToolExecution

const listener = (
  admitted: readonly string[] = ['probe'],
  lookup: ParameterCorrectionLookup = () => definition,
) => parameterCorrectionListener(new Set(admitted), lookup)

const accept = async (): Promise<PostToolDecision> => ({ kind: 'accept' })

describe('parameterCorrectionListener', () => {
  it('delegates without inspecting a name outside its admitted set', async () => {
    const next = vi.fn(accept)
    const decision = await listener([])(execution({ reff: 'x' }), invalidArguments, next)
    expect(next).toHaveBeenCalledOnce()
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('delegates a non-error result', async () => {
    const next = vi.fn(accept)
    const success: ToolExecutionResult = { isError: false, value: 'ok', content: [] }
    expect(await listener()(execution({ reff: 'x' }), success, next)).toEqual({ kind: 'accept' })
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves a block decision untouched', async () => {
    const blocked: PostToolDecision = {
      kind: 'block',
      feedback: [{ type: 'text', text: 'blocked' }],
    }
    const next = async () => blocked
    expect(await listener()(execution({ reff: 'x' }), invalidArguments, next)).toEqual(blocked)
  })

  it('leaves a value replacement untouched', async () => {
    const replaced: PostToolDecision = { kind: 'accept', value: 'ok' }
    const next = async () => replaced
    expect(await listener()(execution({ reff: 'x' }), invalidArguments, next)).toEqual(replaced)
  })

  it('appends to content a downstream listener replaced', async () => {
    const next = async (): Promise<PostToolDecision> => ({
      kind: 'accept',
      content: [{ type: 'text', text: 'downstream' }],
    })
    const decision = await listener()(execution({ reff: 'x' }), invalidArguments, next)
    expect(decision).toEqual({
      kind: 'accept',
      content: [
        { type: 'text', text: 'downstream' },
        {
          type: 'text',
          text: parameterCorrectionHint('probe', { input: 'reff', expected: 'ref' }),
        },
      ],
    })
  })

  it('appends to the original content when no listener replaced it', async () => {
    const decision = await listener()(execution({ reff: 'x' }), invalidArguments, accept)
    expect(decision).toEqual({
      kind: 'accept',
      content: [
        { type: 'text', text: 'Error: invalid arguments' },
        {
          type: 'text',
          text: parameterCorrectionHint('probe', { input: 'reff', expected: 'ref' }),
        },
      ],
    })
  })

  it('leaves a call with nothing to correct untouched', async () => {
    const decision = await listener()(execution({ ref: 'x' }), invalidArguments, accept)
    expect(decision).toEqual({ kind: 'accept' })
  })

  it('leaves a call whose definition no longer resolves untouched', async () => {
    const decision = await listener(['probe'], () => undefined)(
      execution({ reff: 'x' }),
      invalidArguments,
      accept,
    )
    expect(decision).toEqual({ kind: 'accept' })
  })
})
