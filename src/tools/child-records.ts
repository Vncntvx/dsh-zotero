/**
 * Shared child-object record schemas for the model contract.
 *
 * `zotero_get` (detail includes) and `zotero_children` (graph walk) serve the
 * same three shapes — note, annotation, attachment — and the output schema is
 * the model contract, so a drift between the two files would fork the
 * contract. A single source keeps them identical by construction.
 * @module dsh-zotero/tools/child-records
 */

/** One child note row: ref, text, truncation flag, and optional parent. */
export const NOTE_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    parentRef: { type: 'string' },
  },
} as const

/** One annotation row: type/text plus the annotator's own view fields. */
export const ANNOTATION_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    type: { type: 'string', required: true },
    text: { type: 'string', required: true },
    comment: { type: 'string' },
    color: { type: 'string' },
    pageLabel: { type: 'string' },
    parentRef: { type: 'string' },
  },
} as const

/** One attachment row: identity, title, content type, and link mode. */
export const ATTACHMENT_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    contentType: { type: 'string', required: true },
    linkMode: { type: 'string' },
  },
} as const
