// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  noteDraftFormat,
  noteDraftFormats,
  noteDraftKey,
  readNoteDraft,
  writeNoteDraft,
} from '../../../src/client/reader/note-draft.ts'
import {
  ZOTERO_READER_NOTE_HTML_CHARS,
  ZOTERO_READER_NOTE_TEXT_CHARS,
} from '../../../src/constants.ts'

const ref = 'zotero://user/0/item/NOTE0001?server=instance-a'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('parses legacy and structured formatting only within complete text boundaries', () => {
  const text = 'Recent 𝒳 result'
  expect(noteDraftFormat(undefined, text)).toBeUndefined()
  expect(noteDraftFormat('unknown', text)).toBeUndefined()
  expect(noteDraftFormat('strong', text)).toEqual({ format: 'strong' })
  expect(noteDraftFormat('strong:3:4:extra', text)).toBeUndefined()
  expect(noteDraftFormat('strong:7:8', text)).toBeUndefined()
  expect(noteDraftFormat('strong:3:10', text)).toEqual({
    format: 'strong',
    formatRange: { start: 3, end: 10 },
  })

  expect(noteDraftFormats(undefined, text)).toEqual([])
  expect(noteDraftFormats('unknown', text)).toEqual([])
  expect(noteDraftFormats('strong:3:10', text)).toEqual([
    { format: 'strong', range: { start: 3, end: 10 } },
  ])
  expect(noteDraftFormats('[]', text)).toEqual([])
  expect(
    noteDraftFormats(JSON.stringify(Array.from({ length: 17 }, () => 'strong')), text),
  ).toEqual([])
  expect(noteDraftFormats(JSON.stringify([null, { format: 'unknown' }]), text)).toEqual([])
  expect(noteDraftFormats(JSON.stringify([{ format: 'strong', range: null }]), text)).toEqual([])
  expect(
    noteDraftFormats(JSON.stringify([{ format: 'strong', range: { start: 7, end: 8 } }]), text),
  ).toEqual([])
  expect(noteDraftFormats(JSON.stringify([{ format: 'strong' }]), text)).toEqual([
    { format: 'strong' },
  ])
})

it('reads only bounded, well-formed drafts from storage', () => {
  expect(noteDraftKey('s', ref, 'delete')).toBeUndefined()
  expect(noteDraftKey('s', 'not-a-ref', 'create')).toBeUndefined()
  const key = noteDraftKey('s', ref, 'create', 'origin')
  expect(key).toContain('origin')
  expect(readNoteDraft(undefined)).toBeUndefined()

  sessionStorage.setItem(key!, 'x'.repeat(ZOTERO_READER_NOTE_HTML_CHARS + 1))
  expect(readNoteDraft(key)).toBeUndefined()
  sessionStorage.setItem(key!, '{')
  expect(readNoteDraft(key)).toBeUndefined()
  sessionStorage.setItem(key!, JSON.stringify({ fields: [] }))
  expect(readNoteDraft(key)).toBeUndefined()
  sessionStorage.setItem(key!, JSON.stringify({ fields: { bad: 'x' } }))
  expect(readNoteDraft(key)).toBeUndefined()
  sessionStorage.setItem(
    key!,
    JSON.stringify({ fields: { markdown: 'x'.repeat(ZOTERO_READER_NOTE_TEXT_CHARS + 1) } }),
  )
  expect(readNoteDraft(key)).toBeUndefined()
  sessionStorage.setItem(
    key!,
    JSON.stringify({ version: 2, submitted: true, fields: { markdown: 'ok' } }),
  )
  expect(readNoteDraft(key)).toEqual({
    retention: 'stored',
    draft: { version: 2, submitted: true, fields: { markdown: 'ok' } },
  })
})

it('falls back to bounded tab memory when storage rejects a draft', () => {
  expect(writeNoteDraft(undefined)).toBe('unavailable')
  const oversizedKey = noteDraftKey('s', ref, 'create')
  expect(
    writeNoteDraft(oversizedKey, {
      fields: { markdown: 'x'.repeat(ZOTERO_READER_NOTE_HTML_CHARS) },
    }),
  ).toBe('unavailable')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage quota', 'QuotaExceededError')
  })
  const keys = Array.from({ length: 17 }, (_, index) =>
    noteDraftKey('s', ref, 'create', `origin-${index}`),
  )
  for (const key of keys.slice(0, 16)) {
    expect(writeNoteDraft(key, { fields: { markdown: 'draft' } })).toBe('memory')
  }
  expect(writeNoteDraft(keys[16], { fields: { markdown: 'draft' } })).toBe('unavailable')
})
