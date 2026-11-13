/**
 * Closed parsing targets and bounded DTOs. URL schemas validate spelling;
 * public-address, DNS, PDF-type, and session-access checks belong to the host.
 * @module tests/unit/enrichment-parse-wire
 */

import { describe, expect, it } from 'vitest'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroParseReceiptView,
  ZoteroStartDocumentParseRequestView,
} from '../../src/contract.js'
import { ZOTERO_ARTIFACT_IMAGE_BYTES, ZOTERO_ARTIFACT_PAGE_CHARS } from '../../src/contract.js'
import { refFieldsOf } from '../../src/ref-grammar.js'
import {
  zoteroDocumentArtifactRequestSchema,
  zoteroDocumentArtifactResultSchema,
  zoteroDocumentParseReceiptRequestSchema,
  zoteroDocumentParseReceiptResultSchema,
  zoteroParseReceiptSchema,
  zoteroParseTargetSchema,
  zoteroStartDocumentParseRequestSchema,
  zoteroStartDocumentParseResultSchema,
} from '../../src/wire-schemas.js'
import {
  ATTACHMENT_KEY,
  GROUP_LIBRARY,
  attachmentRef,
  collectionRef,
  itemRef,
  refOf,
  savedSearchRef,
} from '../helpers/server/keys.js'

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const GENERATION = '22222222-2222-4222-8222-222222222222'
const TARGET = { kind: 'attachment' as const, ref: attachmentRef() }
const START = {
  sessionId: 'parse-wire-session',
  operationId: OPERATION_ID,
  target: TARGET,
  action: 'parse',
} satisfies ZoteroStartDocumentParseRequestView
const ARTIFACT_REQUEST = {
  op: 'inspect',
  sessionId: START.sessionId,
  target: TARGET,
} satisfies ZoteroDocumentArtifactRequestView
const RECEIPT_REQUEST = { sessionId: START.sessionId, operationId: OPERATION_ID }
const RECEIPT = {
  operationId: OPERATION_ID,
  generation: GENERATION,
  sourceId: 'a'.repeat(64),
  targetLabel: 'Selected PDF',
  mode: 'free',
  cached: false,
  artifactId: 'b'.repeat(64),
  fingerprint: 'c'.repeat(64),
  format: 'markdown',
  characterCount: 2000,
  preview: '# Parsed PDF',
} satisfies ZoteroParseReceiptView
const READY_ARTIFACT = {
  kind: 'ready',
  images: [],
  sourceId: RECEIPT.sourceId,
  targetLabel: RECEIPT.targetLabel,
  mode: RECEIPT.mode,
  artifactId: RECEIPT.artifactId,
  fingerprint: RECEIPT.fingerprint,
  characterCount: RECEIPT.characterCount,
} as const
const START_RESULT = {
  operationId: OPERATION_ID,
  generation: GENERATION,
  jobId: 'parse-job',
  status: 'started',
} as const
const REQUESTS = [
  { endpoint: 'start', schema: zoteroStartDocumentParseRequestSchema, value: START },
  { endpoint: 'artifact', schema: zoteroDocumentArtifactRequestSchema, value: ARTIFACT_REQUEST },
  { endpoint: 'receipt', schema: zoteroDocumentParseReceiptRequestSchema, value: RECEIPT_REQUEST },
]

describe('the explicit parse target', () => {
  it('uses the attachment kind for both child and top-level PDFs without parent metadata', () => {
    expect(refFieldsOf(TARGET.ref)).toMatchObject({ kind: 'attachment', key: ATTACHMENT_KEY })
    expect(zoteroParseTargetSchema.parse(TARGET)).toEqual(TARGET)
    expect(zoteroStartDocumentParseRequestSchema.parse(START).target).toEqual(TARGET)
    expect(zoteroDocumentArtifactRequestSchema.parse(ARTIFACT_REQUEST)).toMatchObject({
      target: TARGET,
    })
  })

  it('retains group and server identity in an attachment ref', () => {
    const target = {
      kind: 'attachment',
      ref: `${refOf('attachment', ATTACHMENT_KEY, GROUP_LIBRARY)}?server=S1`,
    }
    expect(zoteroParseTargetSchema.parse(target)).toEqual(target)
  })

  it.each(['http', 'https'])('retains %s URL query and fragment text exactly', (protocol) => {
    const target = {
      kind: 'url',
      url: `${protocol}://example.org/document.pdf?download=1&signature=a%2Fb#page=3`,
    }
    expect(zoteroParseTargetSchema.parse(target)).toEqual(target)
    expect(zoteroStartDocumentParseRequestSchema.parse({ ...START, target }).target).toEqual(target)
    expect(
      zoteroDocumentArtifactRequestSchema.parse({ ...ARTIFACT_REQUEST, target }),
    ).toMatchObject({ target })
  })

  it.each(['http://127.0.0.1/document.pdf', 'https://unresolved.invalid/document.pdf'])(
    'leaves public-address and DNS admission outside the schema for %s',
    (url) => {
      // Syntax acceptance authorizes no fetch; the host must still reject
      // private addresses and resolve/pin a public destination before I/O.
      expect(zoteroParseTargetSchema.parse({ kind: 'url', url })).toEqual({ kind: 'url', url })
    },
  )

  it('accepts the URL length limit and rejects one extra character', () => {
    const prefix = 'https://example.org/document.pdf?q='
    const url = prefix + 'a'.repeat(8192 - prefix.length)
    expect(zoteroParseTargetSchema.parse({ kind: 'url', url }).kind).toBe('url')
    expect(zoteroParseTargetSchema.safeParse({ kind: 'url', url: url + 'a' }).success).toBe(false)
  })

  it.each([
    ['item ref', itemRef()],
    ['annotation ref', refOf('annotation', 'ANNO1111')],
    ['collection ref', collectionRef()],
    ['saved search ref', savedSearchRef()],
    ['wrong key', 'zotero://user/0/attachment/short'],
    ['unrecognized qualifier', `${attachmentRef()}?path=/tmp/document.pdf`],
    ['desktop selection URL', 'zotero://select/library/items/WXYZ6789'],
  ])('rejects an attachment target containing %s', (_name, ref) => {
    expect(zoteroParseTargetSchema.safeParse({ kind: 'attachment', ref }).success).toBe(false)
  })

  it.each([
    ['host path', { kind: 'path', path: '/tmp/document.pdf' }],
    ['raw bytes', { kind: 'bytes', bytes: [37, 80, 68, 70] }],
    ['session file', { kind: 'file', sessionId: START.sessionId, path: 'document.pdf' }],
    ['attachment path', { ...TARGET, path: '/tmp/document.pdf' }],
    ['attachment bytes', { ...TARGET, bytes: [37, 80, 68, 70] }],
    ['attachment parent', { ...TARGET, parentRef: itemRef() }],
    ['unknown attachment field', { ...TARGET, unknown: true }],
    ['mixed target arms', { ...TARGET, url: 'https://example.org/document.pdf' }],
    ['URL headers', { kind: 'url', url: 'https://example.org/document.pdf', headers: {} }],
    ['URL token', { kind: 'url', url: 'https://example.org/document.pdf', token: 'fixture' }],
  ])('rejects caller-supplied %s', (_name, target) => {
    expect(zoteroParseTargetSchema.safeParse(target).success).toBe(false)
  })

  it.each([
    'https://user:password@example.org/document.pdf',
    'https://user@example.org/document.pdf',
    'https://:password@example.org/document.pdf',
    'file:///tmp/document.pdf',
    'ftp://example.org/document.pdf',
    'data:application/pdf;base64,JVBERg==',
    'javascript:alert(1)',
  ])('rejects credentials or a non-HTTP(S) URL: %s', (url) => {
    expect(zoteroParseTargetSchema.safeParse({ kind: 'url', url }).success).toBe(false)
  })

  it.each(['//example.org/document.pdf', 'not a URL'])('rejects a malformed URL: %s', (url) => {
    const target = { kind: 'url', url }
    for (const safeParse of [
      () => zoteroParseTargetSchema.safeParse(target),
      () => zoteroStartDocumentParseRequestSchema.safeParse({ ...START, target }),
      () => zoteroDocumentArtifactRequestSchema.safeParse({ ...ARTIFACT_REQUEST, target }),
    ]) {
      expect(safeParse).not.toThrow()
      expect(safeParse().success).toBe(false)
    }
    expect(() => zoteroParseTargetSchema.parse(target)).toThrow()
    expect(() => zoteroStartDocumentParseRequestSchema.parse({ ...START, target })).toThrow()
    expect(() =>
      zoteroDocumentArtifactRequestSchema.parse({ ...ARTIFACT_REQUEST, target }),
    ).toThrow()
  })
})

describe('parse request DTOs', () => {
  it.each(['parse', 'reparse', 'retry'])('accepts an explicit %s action', (action) => {
    expect(zoteroStartDocumentParseRequestSchema.parse({ ...START, action })).toEqual({
      ...START,
      action,
    })
  })

  it.each(REQUESTS)('requires a bounded session identity on $endpoint', ({ schema, value }) => {
    for (const sessionId of [undefined, null, '', 's'.repeat(257), 42]) {
      expect(schema.safeParse({ ...value, sessionId }).success).toBe(false)
    }
    const maximum = { ...value, sessionId: 's'.repeat(256) }
    expect(schema.parse(maximum)).toEqual(maximum)
  })

  it.each(REQUESTS)('rejects undeclared request fields on $endpoint', ({ schema, value }) => {
    for (const extra of [
      { path: '/tmp/document.pdf' },
      { bytes: [37, 80] },
      { mode: 'pro' },
      { unknown: true },
    ]) {
      expect(schema.safeParse({ ...value, ...extra }).success).toBe(false)
    }
  })

  it.each([undefined, '', 'operation-1', 'x'.repeat(36)])(
    'requires a UUID operation identity: %s',
    (operationId) => {
      expect(
        zoteroStartDocumentParseRequestSchema.safeParse({ ...START, operationId }).success,
      ).toBe(false)
      expect(
        zoteroDocumentParseReceiptRequestSchema.safeParse({ ...RECEIPT_REQUEST, operationId })
          .success,
      ).toBe(false)
    },
  )

  it.each([undefined, 'upload', 'resume', 'Parse'])(
    'rejects an undeclared action: %s',
    (action) => {
      expect(zoteroStartDocumentParseRequestSchema.safeParse({ ...START, action }).success).toBe(
        false,
      )
    },
  )
})

describe('bounded parse receipts and result DTOs', () => {
  it('accepts exact receipt text limits and an optional positive page count', () => {
    const receipt = {
      ...RECEIPT,
      targetLabel: 'l'.repeat(2048),
      preview: 'p'.repeat(4096),
      pageCount: 1,
    }
    expect(zoteroParseReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(zoteroParseReceiptSchema.parse({ ...RECEIPT, characterCount: 0, preview: '' })).toEqual({
      ...RECEIPT,
      characterCount: 0,
      preview: '',
    })
  })

  it.each([
    ['operation UUID', { operationId: 'operation-1' }],
    ['generation UUID', { generation: 'generation-1' }],
    ['source digest length', { sourceId: 'a'.repeat(63) }],
    ['artifact digest spelling', { artifactId: 'B'.repeat(64) }],
    ['fingerprint spelling', { fingerprint: 'g'.repeat(64) }],
    ['empty label', { targetLabel: '' }],
    ['label bound', { targetLabel: 'l'.repeat(2049) }],
    ['preview bound', { preview: 'p'.repeat(4097) }],
    ['character count sign', { characterCount: -1 }],
    ['character count integer', { characterCount: 0.5 }],
    ['page count sign', { pageCount: 0 }],
    ['page count integer', { pageCount: 1.5 }],
    ['format', { format: 'text' }],
    ['mode', { mode: 'automatic' }],
    ['cache flag type', { cached: 'false' }],
    ['host path', { path: '/tmp/full.md' }],
    ['raw bytes', { bytes: [37, 80, 68, 70] }],
    ['full document', { markdown: '# unbounded body' }],
    ['signed URL', { url: 'https://example.org/result?signature=fixture' }],
    ['credential', { token: 'fixture' }],
    ['unknown field', { unknown: true }],
  ])('rejects an invalid receipt %s in every receipt-carrying result', (_name, change) => {
    const receipt = { ...RECEIPT, ...change }
    expect(zoteroParseReceiptSchema.safeParse(receipt).success).toBe(false)
    expect(
      zoteroStartDocumentParseResultSchema.safeParse({ ...START_RESULT, receipt }).success,
    ).toBe(false)
    expect(
      zoteroDocumentParseReceiptResultSchema.safeParse({ kind: 'completed', receipt }).success,
    ).toBe(false)
  })

  it.each(['started', 'joined', 'completed'])('accepts the %s start result', (status) => {
    const result = {
      ...START_RESULT,
      status,
      ...(status === 'completed' ? { receipt: RECEIPT } : {}),
    }
    expect(zoteroStartDocumentParseResultSchema.parse(result)).toEqual(result)
  })

  it.each(['missing', 'expired'])('accepts an artifact %s result with no payload', (kind) => {
    expect(zoteroDocumentArtifactResultSchema.parse({ kind })).toEqual({ kind })
    expect(
      zoteroDocumentArtifactResultSchema.safeParse({ kind, path: '/tmp/full.md' }).success,
    ).toBe(false)
  })

  it('accepts bounded ready-artifact metadata without document contents', () => {
    const result = { ...READY_ARTIFACT, targetLabel: 'l'.repeat(2048), pageCount: 1 }
    expect(zoteroDocumentArtifactResultSchema.parse(result)).toEqual(result)
  })

  it('accepts one bounded document page and refuses an unbounded body or a host path', () => {
    const page = {
      offset: 0,
      text: 'm'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS),
      totalChars: 40000,
    }
    const result = { kind: 'page', lease: OPERATION_ID, artifactId: RECEIPT.artifactId, page }
    expect(zoteroDocumentArtifactResultSchema.parse(result)).toEqual(result)
    const read = { sessionId: START.sessionId, op: 'page', lease: OPERATION_ID, offset: 16384 }
    expect(zoteroDocumentArtifactRequestSchema.parse(read)).toEqual(read)
    for (const invalid of [
      { ...result, page: { ...page, text: 'm'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS + 1) } },
      { ...result, page: { ...page, path: '/tmp/full.md' } },
      { ...result, page: { ...page, url: 'https://example.org/secret' } },
      { ...result, markdown: '# unbounded body' },
    ])
      expect(zoteroDocumentArtifactResultSchema.safeParse(invalid).success).toBe(false)
    for (const invalid of [
      { ...read, offset: -1 },
      { ...read, offset: 1.5 },
      { ...read, path: '/tmp/full.md' },
    ])
      expect(zoteroDocumentArtifactRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts one bounded figure and refuses a path, an unknown type, or an oversized body', () => {
    const image = {
      kind: 'image' as const,
      lease: OPERATION_ID,
      artifactId: RECEIPT.artifactId,
      name: 'images/page_0_figure.png',
      mediaType: 'image/png' as const,
      base64: Buffer.alloc(1024).toString('base64'),
    }
    expect(zoteroDocumentArtifactResultSchema.parse(image)).toEqual(image)
    const request = {
      sessionId: START.sessionId,
      op: 'image',
      lease: OPERATION_ID,
      name: image.name,
    }
    expect(zoteroDocumentArtifactRequestSchema.parse(request)).toEqual(request)
    for (const invalid of [
      { ...image, name: '/tmp/images/figure.png' },
      { ...image, name: 'images/../../secrets.png' },
      { ...image, name: 'images/figure.svg' },
      { ...image, mediaType: 'image/svg+xml' },
      { ...image, path: '/tmp/images/figure.png' },
      {
        ...image,
        base64: 'a'.repeat(Math.ceil(ZOTERO_ARTIFACT_IMAGE_BYTES / 3) * 4 + 4),
      },
    ])
      expect(zoteroDocumentArtifactResultSchema.safeParse(invalid).success).toBe(false)
    for (const invalid of [
      { ...request, name: '../full.md' },
      { ...request, path: '/tmp' },
      { ...request, offset: 0 },
    ])
      expect(zoteroDocumentArtifactRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it.each([
    ['source digest length', { sourceId: 'a'.repeat(65) }],
    ['artifact digest', { artifactId: 'invalid' }],
    ['fingerprint', { fingerprint: 'invalid' }],
    ['label bound', { targetLabel: 'l'.repeat(2049) }],
    ['character count', { characterCount: -1 }],
    ['page count', { pageCount: 0 }],
    ['host path', { path: '/tmp/full.md' }],
    ['body preview', { preview: 'body' }],
    ['unknown field', { unknown: true }],
  ])('rejects ready-artifact %s', (_name, change) => {
    expect(
      zoteroDocumentArtifactResultSchema.safeParse({ ...READY_ARTIFACT, ...change }).success,
    ).toBe(false)
  })

  it.each([
    { kind: 'pending', jobId: 'parse-job', generation: GENERATION },
    { kind: 'completed', receipt: RECEIPT },
    { kind: 'failed', code: 'ZOTERO_ENRICHMENT_TASK_FAILED', message: 'Parsing failed' },
    { kind: 'cancelled', code: 'ZOTERO_ABORTED', message: 'Parsing cancelled' },
  ])('accepts the $kind receipt result', (result) => {
    expect(zoteroDocumentParseReceiptResultSchema.parse(result)).toEqual(result)
    expect(
      zoteroDocumentParseReceiptResultSchema.safeParse({ ...result, unknown: true }).success,
    ).toBe(false)
  })

  it.each([
    ['operation UUID', { operationId: 'invalid' }],
    ['generation UUID', { generation: 'invalid' }],
    ['empty job identity', { jobId: '' }],
    ['job identity bound', { jobId: 'j'.repeat(257) }],
    ['unknown status', { status: 'running' }],
    ['host path', { path: '/tmp/full.md' }],
  ])('rejects start-result %s', (_name, change) => {
    expect(
      zoteroStartDocumentParseResultSchema.safeParse({ ...START_RESULT, ...change }).success,
    ).toBe(false)
  })

  it('bounds pending job identity and terminal error text', () => {
    const pending = { kind: 'pending', jobId: 'j'.repeat(256), generation: GENERATION }
    expect(zoteroDocumentParseReceiptResultSchema.parse(pending)).toEqual(pending)
    expect(
      zoteroDocumentParseReceiptResultSchema.safeParse({ ...pending, jobId: 'j'.repeat(257) })
        .success,
    ).toBe(false)
    expect(
      zoteroDocumentParseReceiptResultSchema.safeParse({ ...pending, generation: 'invalid' })
        .success,
    ).toBe(false)
    for (const kind of ['failed', 'cancelled']) {
      const result = { kind, code: 'ZOTERO_ENRICHMENT_TASK_FAILED', message: 'm'.repeat(2048) }
      expect(zoteroDocumentParseReceiptResultSchema.parse(result)).toEqual(result)
      expect(
        zoteroDocumentParseReceiptResultSchema.safeParse({ ...result, message: 'm'.repeat(2049) })
          .success,
      ).toBe(false)
      expect(
        zoteroDocumentParseReceiptResultSchema.safeParse({ ...result, code: '' }).success,
      ).toBe(false)
    }
  })
})
