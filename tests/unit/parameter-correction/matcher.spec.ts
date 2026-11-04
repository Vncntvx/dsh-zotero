/** The pure parameter-correction matcher: when a name suggestion is safe. */
import { describe, expect, it } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { parameterCorrectionOf } from '../../../src/parameter-correction.ts'

const parameters = {
  type: 'object',
  properties: {
    refs: { type: 'array' },
    cake: { type: 'string' },
    make: { type: 'string' },
  },
  required: ['refs'],
}

const invalidArguments: ToolExecutionResult = {
  isError: true,
  error: {
    message: 'invalid arguments',
    info: { name: 'ToolArgsError', code: 'INVALID_ARGS' },
  },
  content: [{ type: 'text', text: 'Error: invalid arguments' }],
}

describe('parameterCorrectionOf', () => {
  it('pairs one undeclared argument with the missing required parameter', () => {
    expect(parameterCorrectionOf(parameters, { ref: 'x' }, invalidArguments)).toEqual({
      input: 'ref',
      expected: 'refs',
    })
  })

  it('treats an adjacent transposition as one edit', () => {
    const transposed = {
      ...parameters,
      properties: { ...parameters.properties, format: { type: 'string' } },
      required: ['format'],
    }
    expect(parameterCorrectionOf(transposed, { fromat: 'x' }, invalidArguments)).toEqual({
      input: 'fromat',
      expected: 'format',
    })
  })

  it('normalizes case and separators before comparing', () => {
    const separated = {
      ...parameters,
      properties: { ...parameters.properties, item_key: { type: 'string' } },
      required: ['item_key'],
    }
    expect(parameterCorrectionOf(separated, { ITEMKEY: 'x' }, invalidArguments)).toEqual({
      input: 'ITEMKEY',
      expected: 'item_key',
    })
  })

  it('leaves a non-error result alone', () => {
    expect(
      parameterCorrectionOf(
        parameters,
        { ref: 'x' },
        {
          isError: false,
          value: 'ok',
          content: [],
        },
      ),
    ).toBeUndefined()
  })

  it('ignores a declared argument while looking for the typo', () => {
    const declaredRef = {
      ...parameters,
      properties: { ...parameters.properties, ref: { type: 'string' } },
    }
    expect(
      parameterCorrectionOf(declaredRef, { ref: 'x', include: 'y' }, invalidArguments),
    ).toBeUndefined()
  })

  it('leaves a different error code alone', () => {
    expect(
      parameterCorrectionOf(
        parameters,
        { ref: 'x' },
        {
          isError: true,
          error: {
            message: 'Zotero is unavailable',
            info: { name: 'ZoteroError', code: 'ZOTERO_OFFLINE' },
          },
          content: [],
        },
      ),
    ).toBeUndefined()
  })

  it('leaves an error without structured info alone', () => {
    expect(
      parameterCorrectionOf(
        parameters,
        { ref: 'x' },
        {
          isError: true,
          error: { message: 'invalid arguments' },
          content: [],
        },
      ),
    ).toBeUndefined()
  })

  it('leaves non-record arguments alone', () => {
    expect(parameterCorrectionOf(parameters, null, invalidArguments)).toBeUndefined()
  })

  it('leaves a schema without properties alone', () => {
    expect(
      parameterCorrectionOf({ type: 'object', required: ['refs'] }, { ref: 'x' }, invalidArguments),
    ).toBeUndefined()
  })

  it('leaves a schema whose required list is not an array alone', () => {
    expect(
      parameterCorrectionOf({ ...parameters, required: 'refs' }, { ref: 'x' }, invalidArguments),
    ).toBeUndefined()
  })

  it('leaves a call with no missing required name alone', () => {
    expect(parameterCorrectionOf(parameters, { refs: [] }, invalidArguments)).toBeUndefined()
  })

  it('leaves a distant undeclared name alone', () => {
    expect(parameterCorrectionOf(parameters, { include: 'x' }, invalidArguments)).toBeUndefined()
  })

  it('leaves an ambiguous tie alone', () => {
    const tie = {
      ...parameters,
      properties: { ...parameters.properties, cake: { type: 'string' }, make: { type: 'string' } },
      required: ['cake', 'make'],
    }
    // "bake" is one edit from both required names, so neither is a safe guess.
    expect(parameterCorrectionOf(tie, { bake: 'x' }, invalidArguments)).toBeUndefined()
  })

  it('leaves two corrections alone rather than guessing between them', () => {
    const two = {
      ...parameters,
      properties: { ...parameters.properties, tags: { type: 'array' } },
      required: ['refs', 'tags'],
    }
    expect(parameterCorrectionOf(two, { ref: 'x', tag: 'y' }, invalidArguments)).toBeUndefined()
  })

  it('leaves a name that normalizes to empty alone', () => {
    expect(parameterCorrectionOf(parameters, { __: 'x' }, invalidArguments)).toBeUndefined()
  })

  it('allows two edits on a long name', () => {
    const long = {
      ...parameters,
      properties: { ...parameters.properties, maxSearchResults: { type: 'integer' } },
      required: ['maxSearchResults'],
    }
    expect(parameterCorrectionOf(long, { maxSerchResult: 10 }, invalidArguments)).toEqual({
      input: 'maxSerchResult',
      expected: 'maxSearchResults',
    })
  })

  it('skips non-string and undeclared required entries', () => {
    const odd = {
      ...parameters,
      required: [42, 'ghost', 'refs'],
    }
    expect(parameterCorrectionOf(odd, { ref: 'x' }, invalidArguments)).toEqual({
      input: 'ref',
      expected: 'refs',
    })
  })
})
