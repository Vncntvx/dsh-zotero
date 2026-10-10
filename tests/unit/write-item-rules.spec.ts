/**
 * `write-item-rules`: the dual-end item-shape rules the create/update tools
 * and the write domain share. One spec pins every refusal (message identity,
 * not just the error code), and every accepted shape, so the two ends cannot
 * drift and the rule module carries no untested arms.
 * @module tests/unit/write-item-rules
 */

import { describe, expect, it } from 'vitest'
import {
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeCreatorNameMessage,
  writeFieldNotUpdatableMessage,
  writeItemTypeUnsupportedMessage,
  writeNonBlankMessage,
} from '../../src/errors.js'
import {
  normalizeCreator,
  requireCreatableItemType,
  requireTitleOrUrl,
  requireUpdatableField,
  wireFieldOf,
} from '../../src/write-item-rules.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../../src/errors.js'

const thrown = (run: () => unknown): ZoteroError => {
  try {
    run()
  } catch (error) {
    return error as ZoteroError
  }
  throw new Error('expected the call to be refused')
}

describe('requireCreatableItemType', () => {
  it('accepts every whitelisted type and refuses the rest with the closed-set message', () => {
    expect(requireCreatableItemType('journalArticle')).toBe('journalArticle')
    const error = thrown(() => requireCreatableItemType('attachment'))
    expect(error.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(error.message).toBe(writeItemTypeUnsupportedMessage('attachment'))
  })
})

describe('requireTitleOrUrl', () => {
  it('accepts either field and refuses only when both are blank', () => {
    expect(requireTitleOrUrl('A title', '')).toBeUndefined()
    expect(requireTitleOrUrl('', 'https://example.org')).toBeUndefined()
    const error = thrown(() => requireTitleOrUrl('', ''))
    expect(error.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(error.message).toBe(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE)
  })
})

describe('normalizeCreator', () => {
  it('shapes a single-field name creator', () => {
    expect(normalizeCreator({ creatorType: 'author', name: ' Wu, Lei ' }, 0)).toEqual({
      creatorType: 'author',
      name: 'Wu, Lei',
    })
  })

  it('shapes a firstName/lastName pair and drops empty halves on either side', () => {
    expect(
      normalizeCreator({ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }, 0),
    ).toEqual({ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' })
    expect(normalizeCreator({ creatorType: 'author', lastName: 'Lovelace' }, 0)).toEqual({
      creatorType: 'author',
      lastName: 'Lovelace',
    })
    expect(normalizeCreator({ creatorType: 'author', firstName: ' Ada ' }, 0)).toEqual({
      creatorType: 'author',
      firstName: 'Ada',
    })
  })

  it('refuses a missing or blank creatorType with the non-blank message', () => {
    // `undefined` is not expressible in the static type; the rule module
    // still guards it because a direct domain caller can carry one.
    for (const creatorType of [undefined, '   '] as (string | undefined)[]) {
      const creator = { creatorType: creatorType as string, name: 'x' }
      const error = thrown(() => normalizeCreator(creator, 2))
      expect(error.code).toBe(ZOTERO_INVALID_ARGUMENT)
      expect(error.message).toBe(writeNonBlankMessage('creators[2].creatorType'))
    }
  })

  it('refuses an entry with no usable name fields with the shared wording', () => {
    const error = thrown(() =>
      normalizeCreator({ creatorType: 'author', firstName: '  ', lastName: '' }, 1),
    )
    expect(error.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(error.message).toBe(writeCreatorNameMessage(1))
  })
})

describe('requireUpdatableField and wireFieldOf', () => {
  it('accepts the closed set and refuses the rest with the derived list message', () => {
    expect(requireUpdatableField('title')).toBeUndefined()
    expect(requireUpdatableField('extra')).toBeUndefined()
    const error = thrown(() => requireUpdatableField('creators'))
    expect(error.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(error.message).toBe(writeFieldNotUpdatableMessage('creators'))
  })

  it('maps doi to the wire name and passes every other field through', () => {
    expect(wireFieldOf('doi')).toBe('DOI')
    expect(wireFieldOf('title')).toBe('title')
    expect(wireFieldOf('extra')).toBe('extra')
  })
})
