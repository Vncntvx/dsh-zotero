/**
 * Shared child-object record schemas for the model contract.
 *
 * `zotero_get` (detail includes) and the panel child-page reader (graph walk) serve the
 * same three shapes (note, annotation, attachment), and the output schema is
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

/** One attachment row: identity, title, content type, link mode, and optional file path or URL. */
export const LOCATION_RECORD = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'file', required: true },
        path: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'url', required: true },
        url: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'unavailable', required: true },
        reason: { type: 'string', required: true },
      },
    },
  ],
} as const

export const ATTACHMENT_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    contentType: { type: 'string', required: true },
    location: LOCATION_RECORD,
    linkMode: { type: 'string' },
    path: { type: 'string' },
    url: { type: 'string' },
  },
} as const

export const CHILD_PAGE_FIELDS = {
  completeness: { type: 'string', enum: ['complete', 'page'] },
  offset: { type: 'integer' },
  limit: { type: 'integer' },
  nextOffset: { type: 'integer' },
} as const
