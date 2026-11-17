/** Captured item shapes and legacy samples have explicit, independently checkable provenance. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { normalizeSearchItem } from '../../../src/normalize-search.js'
import { ctx } from './normalize-helpers.js'

const root = new URL('../../fixtures/', import.meta.url)
const provenance = JSON.parse(readFileSync(new URL('item-provenance.json', root), 'utf8'))

it.each(Object.keys(provenance.entries))('pins the documented origin and bytes of %s', (name) => {
  const entry = provenance.entries[name]
  expect(
    createHash('sha256')
      .update(readFileSync(new URL(name, root)))
      .digest('hex'),
  ).toBe(entry.sha256)
  expect(entry.sanitization.length).toBeGreaterThan(0)
  if (entry.kind === 'captured-sanitized') {
    expect(entry.sourceBuild).toBeTruthy()
    expect(entry.captureDate).toBeTruthy()
    expect(entry.rawSha256).toMatch(/^[a-f0-9]{64}$/)
  } else {
    expect(entry.captureDate).toBeNull()
    expect(entry.sourceBuild).toBeNull()
    expect(entry.firstRepositoryCommit).toMatch(/^[a-f0-9]{40}$/)
  }
})

it('normalizes the newly captured real wire shape after deterministic anonymization', () => {
  const record = JSON.parse(readFileSync(new URL('item-live-sanitized.json', root), 'utf8'))
  const result = normalizeSearchItem(record, ctx('capture-server'))
  expect(result).toMatchObject({
    ref: 'zotero://user/0/item/CAPTURE1?server=capture-server',
    title: 'Captured Zotero fixture',
    itemType: record.data.itemType,
  })
  expect(result.creatorSummary).toBe(record.meta.creatorSummary)
  expect(result.year).toBe(2026)
})
