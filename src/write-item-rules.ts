/**
 * The item-shape rules both ends of an item create or update enforce: the
 * tool end before the plan card, the domain end for any caller that reaches
 * the domain without that tool. One implementation per rule and one wording
 * per refusal, so the two ends never drift.
 * @module dsh-zotero/write-item-rules
 */

import {
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeCreatorNameMessage,
  writeFieldNotUpdatableMessage,
  writeItemTypeUnsupportedMessage,
  writeListEmptyMessage,
  writeNonBlankMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZoteroError,
} from './errors.js'
import {
  ZOTERO_CREATABLE_ITEM_TYPES,
  ZOTERO_UPDATABLE_ITEM_FIELDS,
  type ZoteroCreatableItemType,
  type ZoteroCreator,
  type ZoteroUpdatableItemField,
} from './types.js'

const CREATABLE_ITEM_TYPES: ReadonlySet<string> = new Set(ZOTERO_CREATABLE_ITEM_TYPES)

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(ZOTERO_UPDATABLE_ITEM_FIELDS)

/** Refuse an item type outside the closed creation whitelist. */
export function requireCreatableItemType(value: string): ZoteroCreatableItemType {
  if (!CREATABLE_ITEM_TYPES.has(value)) {
    throw new ZoteroError(writeItemTypeUnsupportedMessage(value), ZOTERO_INVALID_ARGUMENT)
  }
  return value as ZoteroCreatableItemType
}

/** Refuse an item create that carries neither a title nor a URL. */
export function requireTitleOrUrl(title: string, url: string): void {
  if (title === '' && url === '') {
    throw new ZoteroError(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
}

/**
 * Validate one creator entry and shape its wire form: a blank `creatorType`
 * and an entry that names no usable name field are refusals; a non-empty
 * `name` wins over the `firstName`/`lastName` pair, and empty parts are
 * dropped instead of sent as blank strings.
 */
export function normalizeCreator(creator: ZoteroCreator, index: number): ZoteroCreator {
  const creatorType = (creator.creatorType ?? '').trim()
  if (creatorType === '') {
    throw new ZoteroError(
      writeNonBlankMessage(`creators[${index}].creatorType`),
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const name = creator.name?.trim() ?? ''
  const firstName = creator.firstName?.trim() ?? ''
  const lastName = creator.lastName?.trim() ?? ''
  if (name === '' && firstName === '' && lastName === '') {
    throw new ZoteroError(writeCreatorNameMessage(index), ZOTERO_INVALID_ARGUMENT)
  }
  if (name !== '') return { creatorType, name }
  return {
    creatorType,
    ...(firstName !== '' ? { firstName } : {}),
    ...(lastName !== '' ? { lastName } : {}),
  }
}

/** Refuse an update field outside the closed updatable set. */
export function requireUpdatableField(field: string): asserts field is ZoteroUpdatableItemField {
  if (!UPDATABLE_FIELDS.has(field)) {
    throw new ZoteroError(writeFieldNotUpdatableMessage(field), ZOTERO_INVALID_ARGUMENT)
  }
}

/**
 * Validate and normalize the fields of an item update (`set`).
 * Enforces non-empty set, updatable fields whitelist, and non-blank values.
 */
export function validateItemUpdateFields(
  set: Record<string, unknown> | undefined,
): Map<ZoteroUpdatableItemField, string> {
  const entries = Object.entries(set ?? {})
  if (entries.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('set'), ZOTERO_INVALID_ARGUMENT)
  }
  const updates = new Map<ZoteroUpdatableItemField, string>()
  for (const [field, value] of entries) {
    requireUpdatableField(field)
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ZoteroError(writeNonBlankMessage(`set.${field}`), ZOTERO_INVALID_ARGUMENT)
    }
    updates.set(field, value.trim())
  }
  return updates
}

/** Zotero's wire name for one updatable field (`doi` rides as `DOI`). */
export function wireFieldOf(field: ZoteroUpdatableItemField): string {
  return field === 'doi' ? 'DOI' : field
}
