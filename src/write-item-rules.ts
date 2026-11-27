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
  ZOTERO_UPDATABLE_ANNOTATION_FIELDS,
  ZOTERO_UPDATABLE_ITEM_FIELDS,
} from './constants.js'
import { isNonNegativeSafeInteger } from './json.js'
import type { ZoteroCreatableItemType, ZoteroCreator, ZoteroUpdatableItemField } from './types.js'

const CREATABLE_ITEM_TYPES: ReadonlySet<string> = new Set(ZOTERO_CREATABLE_ITEM_TYPES)

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(ZOTERO_UPDATABLE_ITEM_FIELDS)
const UPDATABLE_ANNOTATION_FIELDS: ReadonlySet<string> = new Set(ZOTERO_UPDATABLE_ANNOTATION_FIELDS)
type UpdateField = ZoteroUpdatableItemField | (typeof ZOTERO_UPDATABLE_ANNOTATION_FIELDS)[number]

/** Reject repeated targets within one batch operation. */
export function requireUniqueBatchItemKey(
  seen: Set<string>,
  key: string,
  operation: 'delete' | 'update',
): void {
  if (seen.has(key))
    throw new ZoteroError(
      operation === 'delete'
        ? `Batch delete repeats item ${key}.`
        : 'A batch cannot update one item more than once.',
      ZOTERO_INVALID_ARGUMENT,
    )
  seen.add(key)
}

/** Refuse an update that carries no mutation before approval or source I/O. */
export function requireUpdateField(fields: Readonly<Record<string, unknown>>): void {
  if (Object.values(fields).every((value) => value === undefined))
    throw new ZoteroError(
      `At least one of ${Object.keys(fields).join(' or ')} must be provided.`,
      ZOTERO_INVALID_ARGUMENT,
    )
}

export function requireWriteSelection(name: string, values: readonly unknown[]): void {
  if (values.length === 0)
    throw new ZoteroError(writeListEmptyMessage(name), ZOTERO_INVALID_ARGUMENT)
}

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

/** Refuse an ordinary item update field outside the closed updatable set. */
export function requireUpdatableField(field: string): asserts field is ZoteroUpdatableItemField {
  if (!UPDATABLE_FIELDS.has(field))
    throw new ZoteroError(writeFieldNotUpdatableMessage(field), ZOTERO_INVALID_ARGUMENT)
}

/**
 * Validate and normalize the fields of an item update (`set`).
 * Item fields require non-blank values. Annotation comments and labels can be cleared.
 */
export function validateItemUpdateFields(
  set: Record<string, unknown> | undefined,
  annotation: boolean,
  expectedVersion: number | undefined,
  hasTagChanges = false,
): [UpdateField, string][] {
  const entries = Object.entries(set ?? {})
  if (entries.length === 0 && !hasTagChanges) {
    throw new ZoteroError(writeListEmptyMessage('set'), ZOTERO_INVALID_ARGUMENT)
  }
  if ((annotation || expectedVersion !== undefined) && !isNonNegativeSafeInteger(expectedVersion))
    throw new ZoteroError(
      'expectedVersion must be a non-negative integer.',
      ZOTERO_INVALID_ARGUMENT,
    )
  const updates: [UpdateField, string][] = []
  for (const [field, value] of entries) {
    if (!annotation) requireUpdatableField(field)
    else if (!UPDATABLE_ANNOTATION_FIELDS.has(field))
      throw new ZoteroError(`set.${field} is invalid for an annotation.`, ZOTERO_INVALID_ARGUMENT)
    const mayClear = field === 'annotationComment' || field === 'annotationPageLabel'
    if (typeof value !== 'string' || (!mayClear && value.trim() === '')) {
      throw new ZoteroError(writeNonBlankMessage(`set.${field}`), ZOTERO_INVALID_ARGUMENT)
    }
    const normalized = annotation ? value.trim().normalize() : value.trim()
    if (field === 'annotationColor' && !/^#[0-9a-f]{6}$/i.test(normalized))
      throw new ZoteroError(
        'annotationColor must be a six-digit hex color.',
        ZOTERO_INVALID_ARGUMENT,
      )
    if (field === 'annotationType' && normalized !== 'highlight' && normalized !== 'underline')
      throw new ZoteroError(
        'annotationType must be highlight or underline.',
        ZOTERO_INVALID_ARGUMENT,
      )
    updates.push([
      field as UpdateField,
      field === 'annotationColor' ? normalized.toLowerCase() : normalized,
    ])
  }
  return updates
}

/** Zotero's wire name for one updatable field (`doi` rides as `DOI`). */
export function wireFieldOf(field: UpdateField): string {
  return field === 'doi' ? 'DOI' : field
}
