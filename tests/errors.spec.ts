import { describe, expect, it } from 'vitest'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_UNEXPECTED,
  ZoteroError,
  errnoCodeOf,
  errorCauseOf,
  errorChainText,
  errorMessageOf,
  isNotFoundError,
  isProviderTimeout,
  isUnreachableCause,
} from '../src/errors.js'

function withCause(cause: unknown): Error {
  return new Error('outer', { cause })
}

describe('errorMessageOf', () => {
  it('reads Error messages', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errorMessageOf('plain string')).toBe('plain string')
    expect(errorMessageOf(42)).toBe('42')
  })
})

describe('errorCauseOf', () => {
  it('reads the cause of an Error', () => {
    const cause = new Error('inner')
    expect(errorCauseOf(withCause(cause))).toBe(cause)
  })

  it('returns undefined for Error-less causes and non-Errors', () => {
    expect(errorCauseOf(new Error('no cause'))).toBeUndefined()
    expect(errorCauseOf('not an error')).toBeUndefined()
  })
})

describe('errnoCodeOf', () => {
  it('reads a string code from the cause chain', () => {
    expect(errnoCodeOf(withCause({ code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED')
  })

  it('returns undefined for causes without a usable code', () => {
    expect(errnoCodeOf(withCause({ code: 7 }))).toBeUndefined()
    expect(errnoCodeOf(withCause({}))).toBeUndefined()
    expect(errnoCodeOf(withCause(null))).toBeUndefined()
    expect(errnoCodeOf(withCause('refused'))).toBeUndefined()
    expect(errnoCodeOf(new Error('no cause'))).toBeUndefined()
  })
})

describe('isProviderTimeout', () => {
  it('recognizes the TimeoutError DOMException', () => {
    expect(isProviderTimeout(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
  })

  it('rejects other errors and non-Errors', () => {
    expect(isProviderTimeout(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
    expect(isProviderTimeout('timeout')).toBe(false)
  })
})

describe('isUnreachableCause', () => {
  it('recognizes unreachable network codes', () => {
    expect(isUnreachableCause(withCause({ code: 'ECONNREFUSED' }))).toBe(true)
    expect(isUnreachableCause(withCause({ code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('rejects unrelated codes and codeless causes', () => {
    expect(isUnreachableCause(withCause({ code: 'UND_ERR_SOCKET' }))).toBe(false)
    expect(isUnreachableCause(withCause({}))).toBe(false)
    expect(isUnreachableCause(new Error('plain'))).toBe(false)
  })
})

describe('errorChainText', () => {
  it('joins an error message with its cause message', () => {
    expect(errorChainText(withCause(new Error('inner')))).toBe('outer inner')
  })

  it('renders just the message when there is no cause', () => {
    expect(errorChainText(new Error('solo'))).toBe('solo')
    expect(errorChainText('plain')).toBe('plain')
  })
})

describe('isNotFoundError', () => {
  it('recognizes only translated 404 domain errors', () => {
    expect(isNotFoundError(new ZoteroError('missing', ZOTERO_NOT_FOUND))).toBe(true)
    expect(isNotFoundError(new ZoteroError('other', ZOTERO_UNEXPECTED))).toBe(false)
    expect(isNotFoundError(new Error('missing'))).toBe(false)
  })
})
