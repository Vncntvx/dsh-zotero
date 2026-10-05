/**
 * The `zotero_attachment` tool surface: file attachments resolved to verified
 * on-disk paths, linked-URL attachments, best-attachment selection from an
 * item ref, and the failure and validation arms.
 * @module tests/tools/attachment
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NOT_A_LOCAL_PATH_MESSAGE,
  missingAttachmentFileMessage,
} from '../../src/local/attachment-location.js'
import { expectedKindRefMessage, invalidRefMessage } from '../../src/refs.js'
import { FILE_ENVIRONMENT_MESSAGE } from '../../src/tools/attachment.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_attachment tool', () => {
  const FILE_ATTACHMENT = {
    key: 'WXYZ6789',
    version: 1,
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  }

  it('registers and exposes its schema to the assembly', () => {
    expect(lane.tool('zotero_attachment')).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_attachment')).toBe(
      true,
    )
  })

  it('resolves a file attachment to a verified on-disk path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      const filePath = join(dir, 'paper.pdf')
      writeFileSync(filePath, '%PDF stub')
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(filePath).href),
      )
      const result = expectValue(
        await runTool('zotero_attachment', { ref: 'zotero://user/0/attachment/WXYZ6789' }),
        'zotero_attachment',
      )
      expect(result.value).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: filePath,
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain(
        `Full Text PDF (zotero://user/0/attachment/WXYZ6789) application/pdf → ${filePath}`,
      )
      // The path's environment is part of the answer: a reader that runs
      // somewhere else cannot assume it sees the file.
      expect(text).toContain(FILE_ENVIRONMENT_MESSAGE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a file location no local path can express', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('file://otherhost/shared/paper.pdf'),
    )
    const result = await runTool('zotero_attachment', {
      ref: 'zotero://user/0/attachment/WXYZ6789',
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(NOT_A_LOCAL_PATH_MESSAGE)
  })

  it('resolves an item ref to its best attachment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      const filePath = join(dir, 'paper.pdf')
      writeFileSync(filePath, '%PDF stub')
      mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
        helpers.json({
          key: 'ABCD1234',
          version: 3,
          links: {
            attachment: {
              href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
              type: 'application/json',
              attachmentType: 'application/pdf',
            },
          },
          data: { itemType: 'journalArticle', title: 'FlashAttention-2' },
        }),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(filePath).href),
      )
      const result = expectValue(
        await runTool('zotero_attachment', { ref: 'zotero://user/0/item/ABCD1234' }),
        'zotero_attachment',
      )
      expect(mock.requests.map((request) => request.pathname)).toEqual([
        '/api/users/0/items/ABCD1234',
        '/api/users/0/items/WXYZ6789',
        '/api/users/0/items/WXYZ6789/file/view/url',
      ])
      expect(result.value).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: filePath,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves linked-URL attachments without a file request', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: {
          itemType: 'attachment',
          title: 'Preprint',
          contentType: 'application/pdf',
          linkMode: 'linked_url',
          url: 'https://arxiv.org/pdf/2307.08691',
        },
      }),
    )
    const result = expectValue(
      await runTool('zotero_attachment', { ref: 'zotero://user/0/attachment/WXYZ6789' }),
      'zotero_attachment',
    )
    expect(mock.requests).toHaveLength(1)
    expect(result.value).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Preprint',
      contentType: 'application/pdf',
      kind: 'url',
      url: 'https://arxiv.org/pdf/2307.08691',
    })
    expect((result.content[0] as { text: string }).text).toBe(
      'Preprint (zotero://user/0/attachment/WXYZ6789) application/pdf → https://arxiv.org/pdf/2307.08691',
    )
  })

  it('renders untitled attachments by ref with an unknown-type label', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: { itemType: 'attachment', linkMode: 'linked_url', url: 'https://example.com/doc' },
      }),
    )
    const result = expectValue(
      await runTool('zotero_attachment', { ref: 'zotero://user/0/attachment/WXYZ6789' }),
      'zotero_attachment',
    )
    expect((result.content[0] as { text: string }).text).toBe(
      'zotero://user/0/attachment/WXYZ6789 unknown type → https://example.com/doc',
    )
  })

  it('surfaces a missing file as a typed error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(join(dir, 'gone.pdf')).href),
      )
      const result = await runTool('zotero_attachment', {
        ref: 'zotero://user/0/attachment/WXYZ6789',
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toContain(
        missingAttachmentFileMessage(join(dir, 'gone.pdf')),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects malformed and wrong-kind refs before any request', async () => {
    const malformed = await runTool('zotero_attachment', { ref: 'not-a-ref' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain(
      invalidRefMessage('not-a-ref'),
    )

    const wrongKind = await runTool('zotero_attachment', {
      ref: 'zotero://user/0/collection/COLL1234',
    })
    expect(wrongKind.isError).toBe(true)
    if (!wrongKind.isError) throw new Error('unreachable')
    expect((wrongKind.content[0] as { text: string }).text).toContain(
      expectedKindRefMessage(['item', 'attachment'], 'collection'),
    )

    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      lane
        .tool('zotero_attachment')!
        .isConcurrencySafe?.({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
    ).toBe(true)
  })
})
