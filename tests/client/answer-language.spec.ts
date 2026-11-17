/** The model-facing language label derived from the client's active locale. */
import { describe, expect, it } from 'vitest'
import { answerLanguageOf } from '../../src/client/answer-language.js'

describe('answerLanguageOf', () => {
  it('names the harness built-in languages in English and natively', () => {
    expect(answerLanguageOf('en')).toBe('English (en)')
    expect(answerLanguageOf('zh')).toBe('Simplified Chinese (简体中文, zh)')
    expect(answerLanguageOf('ja')).toBe('Japanese (日本語, ja)')
    expect(answerLanguageOf('de')).toBe('German (Deutsch, de)')
  })

  it('normalizes regional and underscore tags without losing the exact id', () => {
    expect(answerLanguageOf('zh-CN')).toBe('Simplified Chinese (简体中文, zh-CN)')
    expect(answerLanguageOf('zh_TW')).toBe('Traditional Chinese (繁體中文, zh_TW)')
    expect(answerLanguageOf('en-US')).toBe('English (en-US)')
  })

  it('names an external language pack through Intl.DisplayNames', () => {
    const label = answerLanguageOf('it')
    expect(label).toBe('Italian (italiano, it)')
  })

  it('falls back to the id when the tag cannot be named', () => {
    expect(answerLanguageOf('not a tag')).toBe('not a tag (not a tag)')
  })

  it('uses English for a blank id', () => {
    expect(answerLanguageOf('   ')).toBe('English (en)')
  })
})
