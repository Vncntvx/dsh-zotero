/**
 * The parameter-correction hint reaches the scholarly component's own tools,
 * not only the core read tools. Validation fails before the save body runs, so
 * no external request and no Zotero service are involved.
 */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { parameterCorrectionHint } from '../../src/parameter-correction.ts'
import ScholarlyService from '../../src/scholarly/index.ts'
import { bootScholarlyContext } from './fixtures.js'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

it('names the rejected argument and the declared parameter for a scholarly tool', async () => {
  ctx = await bootScholarlyContext()
  await ctx.plugin(ScholarlyService, {})

  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId('scholarly-save-1'),
        name: 'scholarly_save_to_zotero',
        arguments: JSON.stringify({ titel: 'A study' }),
      },
    ],
    signal: new AbortController().signal,
  })
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error('scholarly save produced no result')

  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('invalid save arguments unexpectedly succeeded')
  expect(result.error.info?.code).toBe('INVALID_ARGS')
  expect(result.content.at(-1)).toEqual({
    type: 'text',
    text: parameterCorrectionHint('scholarly_save_to_zotero', {
      input: 'titel',
      expected: 'title',
    }),
  })
})
