/**
 * The connectivity diagnosis formatter shared by the plugin detail card and
 * the workspace connection strip: a raw host diagnosis never renders bare
 * inside a localized interface.
 * @module tests/client/diagnosis
 */

import { describe, expect, it } from 'vitest'
import { diagnosisLine, formatDiagnosis } from '../../src/client/components/plugin/diagnosis.ts'
import { zh } from '../../src/client/locales.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

const t = makeTranslate(zh)

describe('formatDiagnosis', () => {
  it('localizes a leading CODE: message pair and keeps the code', () => {
    expect(formatDiagnosis('ZOTERO_NOT_RUNNING: Zotero is not running or unreachable.', t)).toEqual(
      {
        message: zh.diagnosisNotRunning,
        rawCode: 'ZOTERO_NOT_RUNNING',
      },
    )
  })

  it('localizes a known code that rides inside a longer sentence', () => {
    const formatted = formatDiagnosis('probe failed because ZOTERO_TIMEOUT fired', t)
    expect(formatted).toEqual({ message: zh.diagnosisTimeout, rawCode: 'ZOTERO_TIMEOUT' })
  })

  it('maps host prose about a missing service without a code', () => {
    expect(formatDiagnosis('the zotero service is not composed', t)).toEqual({
      message: zh.diagnosisNotComposed,
    })
  })

  it('keeps an unknown CODE: pair as its own message plus the code', () => {
    expect(formatDiagnosis('ZOTERO_SOMETHING_NEW: unexpected shape', t)).toEqual({
      message: 'unexpected shape',
      rawCode: 'ZOTERO_SOMETHING_NEW',
    })
  })

  it('passes bare prose through unchanged', () => {
    expect(formatDiagnosis('connection refused', t)).toEqual({ message: 'connection refused' })
  })

  it('answers an empty diagnosis with the unknown sentence', () => {
    expect(formatDiagnosis('', t)).toEqual({ message: zh.diagnosisUnknown })
    expect(formatDiagnosis('   ', t)).toEqual({ message: zh.diagnosisUnknown })
  })
})

describe('diagnosisLine', () => {
  it('labels the line with the code when there is one', () => {
    expect(diagnosisLine('ZOTERO_API_DISABLED: local API is off', t)).toBe(
      `${zh.diagnosisLabel} ZOTERO_API_DISABLED: ${zh.diagnosisApiDisabled}`,
    )
  })

  it('labels a codeless line with the message alone', () => {
    expect(diagnosisLine('connection refused', t)).toBe(`${zh.diagnosisLabel}: connection refused`)
  })
})
