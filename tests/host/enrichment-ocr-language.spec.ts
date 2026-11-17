import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  cacheKeyOf,
  parseOnce,
  ParseFlight,
  type ParseOnceDeps,
} from '../../src/enrichment/parse-once.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { enrichmentPreferencesOf } from '../../src/enrichment-preferences.ts'

const input = {
  identity: 'zotero://user/0/attachment/ABCDEFGH',
  generation: '7e8148b0-924e-4d05-9c87-1d56792df325',
  bytes: new TextEncoder().encode('%PDF-1.7 body'),
}

it('separates free-mode language caches while pro cache identity ignores the unused setting', () => {
  const free = { ...input, mode: 'free' as const }
  expect(cacheKeyOf(free)).toBe(cacheKeyOf({ ...free, ocrLanguage: 'ch' }))
  expect(cacheKeyOf(free)).not.toBe(cacheKeyOf({ ...free, ocrLanguage: 'en' }))
  const pro = { ...input, mode: 'pro' as const }
  expect(cacheKeyOf({ ...pro, ocrLanguage: 'ch' })).toBe(cacheKeyOf({ ...pro, ocrLanguage: 'en' }))
})

it.each(['', 'two words', '../en', 'a'.repeat(33)])(
  'rejects malformed OCR language %s before I/O',
  (ocrLanguage) => {
    expect(() => enrichmentPreferencesOf({ ocrLanguage })).toThrow('ocrLanguage')
    expect(() => cacheKeyOf({ ...input, mode: 'free', ocrLanguage })).toThrow('language')
  },
)

it.each(['ch', 'en', 'latin'])(
  'sends the admitted free language %s in the actual submit body',
  async (ocrLanguage) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ocr-language-'))
    const halt = new Error('stop after recording submit')
    const json = vi.fn(async (_url: string, _options: { body?: string | Uint8Array }) => {
      throw halt
    })
    try {
      const deps: ParseOnceDeps = {
        store: new ParsedArtifactStore(root),
        flight: new ParseFlight(),
        client: { json } as unknown as ParseOnceDeps['client'],
      }
      await expect(parseOnce({ ...input, mode: 'free', ocrLanguage }, deps)).rejects.toBe(halt)
      const options = json.mock.calls[0]?.[1] as { body: string } | undefined
      expect(JSON.parse(options!.body)).toEqual({
        file_name: 'document.pdf',
        language: ocrLanguage,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
