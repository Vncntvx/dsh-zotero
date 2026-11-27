import { expect, it } from 'vitest'
import type { ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { TEXT_ATTACHMENT_BYTES } from '../../../src/client/reader/text-document.ts'
import { ANNOTATION_KEY, itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { ATTACHMENT, REF, SESSION, SIGNAL, register } from './support/register.ts'

it('reads native annotations from the exact requested attachment and page', async () => {
  const reader = register()
  const request = { sessionId: SESSION, ref: REF, offset: 50, limit: 50 }
  const value = { offset: 50, limit: 50, returned: 0, total: 50, items: [], writeEnabled: false }
  reader.zotero.readerAnnotations.mockResolvedValueOnce({ ok: true, value })
  await expect(reader.face!.annotations(request, SIGNAL)).resolves.toBe(value)
  expect(reader.zotero.readerAnnotations).toHaveBeenCalledExactlyOnceWith(request, SIGNAL)
  expect(reader.zotero.readerCreateAnnotations).not.toHaveBeenCalled()
  reader.dispose()
})

it('routes model translation and comment suggestions through distinct session endpoints', async () => {
  const reader = register()
  const request = { sessionId: SESSION, text: 'Findings' }
  const translation = { ...request, target: 'de' } as const
  reader.zotero.readerSuggestAnnotation.mockResolvedValueOnce({ ok: true, value: 'Comment' })
  reader.zotero.readerTranslate.mockResolvedValueOnce({ ok: true, value: 'Ergebnisse' })
  await expect(reader.face!.translate(translation, SIGNAL)).resolves.toBe('Ergebnisse')
  await expect(reader.face!.suggestAnnotation!(request, SIGNAL)).resolves.toBe('Comment')
  expect(reader.zotero.readerSuggestAnnotation).toHaveBeenCalledExactlyOnceWith(request, SIGNAL)
  expect(reader.zotero.readerTranslate).toHaveBeenCalledExactlyOnceWith(translation, SIGNAL)
  expect(reader.openResourceIn).not.toHaveBeenCalled()
  reader.dispose()
})

it.each([
  { outcome: 'success', result: { ok: true, value: { success: true } }, expected: true },
  { outcome: 'Zotero refusal', result: { ok: true, value: { success: false } }, expected: false },
  {
    outcome: 'remote error',
    result: { ok: false, error: { code: 'zotero/unavailable', message: 'Unavailable' } },
    expected: false,
  },
])(
  'maps the Zotero open-protocol $outcome to the Reader action result',
  async ({ result, expected }) => {
    const reader = register()
    const url = 'zotero://open-pdf/library/items/ABCD1234?page=3'
    reader.zotero.openProtocol.mockResolvedValueOnce(result)

    await expect(reader.face!.openProtocol(url)).resolves.toBe(expected)
    expect(reader.zotero.openProtocol).toHaveBeenCalledExactlyOnceWith(url)
    reader.dispose()
  },
)

it('reads cached region text only for the exact attachment and full PDF fingerprint', async () => {
  const reader = register()
  const fingerprint = 'a'.repeat(64)
  const source = {
    attachmentRef: REF,
    libraryRef: 'zotero://user/0/',
    fingerprint: `sha256:${fingerprint}`,
    title: 'Paper',
  }
  const regions = [{ pageIndex: 2, box: [120, 240, 720, 840] as const }]
  const result = {
    kind: 'ready',
    sourceId: 'source-1',
    sourceRef: REF,
    targetLabel: 'Paper',
    mode: 'free',
    artifactId: 'b'.repeat(64),
    fingerprint,
    characterCount: 12,
    images: [],
    regionText: { text: 'Cached region', incomplete: false },
  }
  reader.zotero.documentArtifact.mockResolvedValueOnce({ ok: true, value: result })

  await expect(reader.face!.readParsedText!(SESSION, source, regions, SIGNAL)).resolves.toEqual(
    result.regionText,
  )
  expect(reader.zotero.documentArtifact).toHaveBeenCalledExactlyOnceWith(
    {
      sessionId: SESSION,
      op: 'inspect',
      target: { kind: 'attachment', ref: REF },
      regionText: { fingerprint, regions },
    },
    SIGNAL,
  )
  reader.dispose()
})

it('does not request cached text without session access or a full PDF fingerprint', async () => {
  const reader = register()
  reader.readAccess.mockReturnValueOnce(false)
  await expect(
    reader.face!.readParsedText!(
      SESSION,
      {
        attachmentRef: REF,
        libraryRef: 'zotero://user/0/',
        fingerprint: 'sha256:abc',
        title: 'Paper',
      },
      [],
      SIGNAL,
    ),
  ).resolves.toBeUndefined()
  reader.readAccess.mockReturnValue(true)
  await expect(
    reader.face!.readParsedText!(
      SESSION,
      {
        attachmentRef: REF,
        libraryRef: 'zotero://user/0/',
        fingerprint: 'pdfjs:legacy',
        title: 'Paper',
      },
      [],
      SIGNAL,
    ),
  ).resolves.toBeUndefined()
  expect(reader.zotero.documentArtifact).not.toHaveBeenCalled()
  reader.dispose()
})

it('discards cached text when session access is revoked during the lookup', async () => {
  const reader = register()
  const pending = deferred<{ ok: true; value: Record<string, unknown> }>()
  reader.zotero.documentArtifact.mockReturnValueOnce(pending.promise)
  const fingerprint = 'a'.repeat(64)
  const read = reader.face!.readParsedText!(
    SESSION,
    {
      attachmentRef: REF,
      libraryRef: 'zotero://user/0/',
      fingerprint: `sha256:${fingerprint}`,
      title: 'Paper',
    },
    [{ pageIndex: 0, box: [0, 0, 100, 100] }],
    SIGNAL,
  )
  reader.readAccess.mockReturnValue(false)
  pending.resolve({
    ok: true,
    value: {
      kind: 'ready',
      sourceRef: REF,
      fingerprint,
      regionText: { text: 'No longer authorized', incomplete: false },
    },
  })

  await expect(read).resolves.toBeUndefined()
  reader.dispose()
})

it('retains per-page receipts and forwards versioned annotation writes without retry', async () => {
  const reader = register()
  const page = {
    pageIndex: 1,
    text: 'Text',
    pageLabel: 'ii',
    textOffset: 3,
    top: 8,
    rects: [{ x: 12, y: 18, width: 60, height: 10 }],
  }
  const creation = {
    sessionId: SESSION,
    ref: REF,
    type: 'highlight',
    color: '#ffd400',
    pages: [page],
  } satisfies Parameters<ReaderTabFace['createAnnotations']>[0]
  const row = {
    sessionId: SESSION,
    ref: `zotero://user/0/annotation/${ANNOTATION_KEY}`,
    expectedVersion: 8,
  }
  const edit = { ...row, set: { annotationType: 'underline' } } as const
  const receipt = {
    kind: 'settled',
    pages: [{ pageIndex: 1, status: 'committed-unverified' }],
  }
  const conflict = { code: 'ZOTERO_WRITE_CONFLICT', message: 'Annotation changed.' }
  const declined = { kind: 'declined', message: 'The reviewed deletion was declined.' }
  reader.zotero.readerCreateAnnotations.mockResolvedValueOnce({ ok: true, value: receipt })
  reader.zotero.readerUpdateAnnotation.mockResolvedValueOnce({ ok: false, error: conflict })
  reader.zotero.readerDeleteAnnotation.mockResolvedValueOnce({ ok: true, value: declined })
  await expect(reader.face!.createAnnotations(creation, SIGNAL)).resolves.toBe(receipt)
  await expect(reader.face!.updateAnnotation(edit, SIGNAL)).rejects.toBe(conflict)
  await expect(reader.face!.deleteAnnotation(row, SIGNAL)).resolves.toBe(declined)
  expect(reader.zotero.readerCreateAnnotations).toHaveBeenCalledExactlyOnceWith(creation, SIGNAL)
  expect(reader.zotero.readerUpdateAnnotation).toHaveBeenCalledExactlyOnceWith(edit, SIGNAL)
  expect(reader.zotero.readerDeleteAnnotation).toHaveBeenCalledExactlyOnceWith(row, SIGNAL)
  reader.dispose()
})

it('stops an inline note image read when the workspace grant expires during attachment resolution', async () => {
  const reader = register()
  const noteRef = `${itemRef(NOTE_KEY)}?server=instance-a`
  const image = { ...ATTACHMENT, parentRef: noteRef, contentType: 'image/png', path: 'figure.png' }
  const pending = deferred<{ ok: true; value: typeof image }>()
  reader.zotero.resolveAttachment.mockReturnValueOnce(pending.promise)
  const reading = reader.face!.readNoteImage!(SESSION, noteRef, REF, SIGNAL)
  expect(reader.zotero.resolveAttachment).toHaveBeenCalledExactlyOnceWith(REF)
  reader.readAccess.mockReturnValue(false)
  pending.resolve({ ok: true, value: image })
  await expect(reading).rejects.toThrow('unavailable')
  expect(reader.readBytes).not.toHaveBeenCalled()
  reader.dispose()
})

it('preserves workspace errors and rejects shifted or oversized text preview windows', async () => {
  const reader = register()
  const location = { ...ATTACHMENT, path: 'papers/fixture.md', contentType: 'text/markdown' }
  reader.zotero.resolveAttachment.mockResolvedValue({ ok: true, value: location })
  const error = { code: 'workspace/unauthorized', message: 'File access revoked' }
  reader.readBytes
    .mockResolvedValueOnce({ ok: false, error })
    .mockResolvedValueOnce({ ok: true, value: { data: reader.bytes, offset: 1, eof: true } })
    .mockResolvedValueOnce({
      ok: true,
      value: { offset: 0, eof: false, data: new Uint8Array(TEXT_ATTACHMENT_BYTES + 1) },
    })
  const read = () => reader.face!.readTextAttachment(SESSION, REF, SIGNAL)
  await expect(read()).rejects.toBe(error)
  await expect(read()).rejects.toThrow('unavailable')
  await expect(read()).rejects.toThrow('unavailable')
  await expect(read()).resolves.toMatchObject({ format: 'markdown', data: reader.bytes })
  expect(reader.readBytes.mock.calls).toEqual(
    Array.from({ length: 4 }, () => [
      SESSION,
      location.path,
      { range: { length: TEXT_ATTACHMENT_BYTES } },
      SIGNAL,
    ]),
  )
  reader.dispose()
})

it.each([
  ['text/plain; charset=utf-8', 'text'],
  ['text/markdown', 'markdown'],
  ['text/x-markdown; charset=utf-8', 'markdown'],
  ['text/html', 'html'],
  ['application/xhtml+xml', 'html'],
] as const)('reads %s attachments as %s', async (contentType, format) => {
  const reader = register()
  reader.zotero.resolveAttachment.mockResolvedValue({
    ok: true,
    value: { ...ATTACHMENT, path: 'papers/source', contentType },
  })

  await expect(reader.face!.readTextAttachment(SESSION, REF, SIGNAL)).resolves.toMatchObject({
    format,
    data: reader.bytes,
  })
  expect(reader.readBytes).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    'papers/source',
    { range: { length: TEXT_ATTACHMENT_BYTES } },
    SIGNAL,
  )
  reader.dispose()
})

it.each(['application/pdf', 'application/octet-stream', 'application/json', 'image/svg+xml'])(
  'rejects %s before reading attachment bytes',
  async (contentType) => {
    const reader = register()
    reader.zotero.resolveAttachment.mockResolvedValue({
      ok: true,
      value: { ...ATTACHMENT, path: 'papers/source', contentType },
    })

    await expect(reader.face!.readTextAttachment(SESSION, REF, SIGNAL)).rejects.toThrow()
    expect(reader.readBytes).not.toHaveBeenCalled()
    reader.dispose()
  },
)
