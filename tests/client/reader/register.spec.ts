import { expect, it } from 'vitest'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { TEXT_ATTACHMENT_BYTES } from '../../../src/client/reader/text-document.ts'
import { readerEn, readerZh } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { ATTACHMENT, REF, SESSION, SIGNAL, loadPdf, runtime, register } from './support/register.ts'

it('re-resolves the exact historical attachment before opening with the cited fingerprint', async () => {
  const reader = register()
  const { openCitation } = reader.citations
  const fingerprint = `sha256:${'a'.repeat(64)}`
  const position = { pageIndex: 1, rects: [] }
  const citation = { attachmentRef: REF, title: ATTACHMENT.title, fingerprint, position }
  await expect(openCitation(SESSION, citation, SIGNAL)).resolves.toBe(true)
  expect(reader.zotero.resolveAttachment).toHaveBeenCalledExactlyOnceWith(REF)
  expect(reader.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    readerAddress(SESSION, REF),
    {
      destination: 'sidebar',
      params: { title: ATTACHMENT.title, expectedFingerprint: fingerprint, position },
    },
  )
  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: true,
    value: { ...ATTACHMENT, ref: REF.replace('instance-a', 'instance-b') },
  })
  await expect(openCitation(SESSION, citation, SIGNAL)).resolves.toBe(false)
  expect(reader.openResourceIn).toHaveBeenCalledOnce()
  reader.dispose()
})

it('only claims a local PDF after the Reader is served and both chunks are available', async () => {
  const disabled = register(false)
  await expect(disabled.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)).resolves.toBe(false)
  const enabled = register()
  expect(enabled.registerLocale).toHaveBeenCalledExactlyOnceWith(
    'zoteroReaderShell',
    expect.anything(),
  )
  const position = { pageIndex: 1, rects: [{ x: 2, y: 6, width: 9, height: 10 }] }
  await expect(enabled.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL, position)).resolves.toBe(true)
  expect(enabled.registerLocale).toHaveBeenLastCalledWith('zoteroReader', {
    en: readerEn,
    zh: readerZh,
  })
  expect(enabled.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    readerAddress(SESSION, REF),
    {
      destination: 'sidebar',
      params: { title: ATTACHMENT.title, position },
    },
  )

  enabled.dispose()
  expect(enabled.closeSlot).toHaveBeenCalledTimes(3)
  expect(enabled.closeTab).toHaveBeenCalledTimes(1)
  expect(enabled.closeLocale).toHaveBeenCalledTimes(2)
  await expect(enabled.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)).resolves.toBe(false)
})

it('opens a note without loading the PDF worker and stops opening after revocation', async () => {
  const reader = register()
  const ref = `${itemRef(NOTE_KEY)}?server=instance-a`
  const title = 'Field notes'
  await expect(reader.openNote(SESSION, REF, title, SIGNAL)).resolves.toBe(false)
  await expect(reader.openNote(SESSION, ref, title, SIGNAL)).resolves.toBe(true)
  expect(reader.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    readerAddress(SESSION, ref, 'note'),
    { destination: 'sidebar', params: { title } },
  )
  expect(loadPdf).not.toHaveBeenCalled()
  expect(reader.zotero.resolveAttachment).not.toHaveBeenCalled()
  reader.readAccess.mockReturnValue(false)
  await expect(reader.openNote(SESSION, ref, title, SIGNAL)).resolves.toBe(false)
  reader.dispose()
})

it('reads only a complete, local raster attachment belonging to the selected note', async () => {
  const reader = register()
  const note = `${itemRef(NOTE_KEY)}?server=instance-a`
  const image = { ...ATTACHMENT, parentRef: note, contentType: 'image/png', path: 'image.png' }
  const resolve = reader.zotero.resolveAttachment
  const read = () => reader.face?.readNoteImage?.(SESSION, note, REF, SIGNAL)
  for (const value of [
    { ...image, ref: REF.replace('instance-a', 'instance-b') },
    { ...image, parentRef: itemRef(NOTE_KEY) },
    { ...image, kind: 'url', url: 'https://example.com/image.png' },
    { ...image, contentType: 'image/svg+xml' },
  ]) {
    resolve.mockResolvedValueOnce({ ok: true, value })
    await expect(read()).rejects.toThrow('unavailable')
  }
  expect(reader.readBytes).not.toHaveBeenCalled()
  resolve.mockResolvedValue({ ok: true, value: image })
  reader.readBytes.mockResolvedValueOnce({ ok: true, value: { offset: 0, eof: false } })
  await expect(read()).rejects.toThrow('unavailable')
  await expect(read()).resolves.toMatchObject({ type: 'image/png', size: 3 })
  expect(reader.readBytes).toHaveBeenLastCalledWith(
    SESSION,
    image.path,
    { range: { length: 2 * 1024 * 1024 } },
    SIGNAL,
  )
  reader.dispose()
  await expect(read()).rejects.toThrow('unavailable')
  expect(reader.readBytes).toHaveBeenCalledTimes(2)
})

it('opens a local snapshot and reads a bounded byte window of its exact attachment', async () => {
  const reader = register()
  const snapshot = { ...ATTACHMENT, path: 'tests/snapshot.html', contentType: 'text/html' }
  reader.zotero.resolveAttachment.mockResolvedValue({ ok: true, value: snapshot })
  await expect(reader.open(SESSION, snapshot, 'sidebar', SIGNAL)).resolves.toBe(true)
  expect(loadPdf).not.toHaveBeenCalled()
  expect(reader.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    readerAddress(SESSION, REF, 'text'),
    { destination: 'sidebar', params: { title: ATTACHMENT.title } },
  )
  await expect(reader.face?.readTextAttachment(SESSION, REF, SIGNAL)).resolves.toMatchObject({
    format: 'html',
    data: reader.bytes,
    eof: true,
  })
  expect(reader.readBytes).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    snapshot.path,
    { range: { length: TEXT_ATTACHMENT_BYTES } },
    SIGNAL,
  )
  reader.zotero.resolveAttachment.mockResolvedValue({
    ok: true,
    value: { ...snapshot, ref: REF.replace('instance-a', 'instance-b') },
  })
  await expect(reader.face?.readTextAttachment(SESSION, REF, SIGNAL)).rejects.toThrow()
  expect(reader.readBytes).toHaveBeenCalledOnce()
  reader.dispose()
})

it('revokes the recent visits snapshot when reading state is disabled', () => {
  const reader = register()
  reader.config.set({
    value: {
      historyLimit: 3,
      persistReadingState: true,
      defaultTranslationTarget: 'auto',
      captureWatermark: false,
    },
  })
  const visit = {
    attachmentRef: REF,
    fingerprint: 'copy-1',
    pageIndex: 0,
    pageOffset: 0,
    fitMode: 'width',
    zoom: 1,
    rotation: 0,
    panels: { outline: false, info: false },
    readingSeconds: 0,
    lastVisitedAt: 1000,
  } as const
  reader.face?.history.save(visit)
  expect(reader.visits.getSnapshot()).toEqual([visit])
  reader.config.set({
    value: {
      historyLimit: 3,
      persistReadingState: false,
      defaultTranslationTarget: 'auto',
      captureWatermark: false,
    },
  })
  expect(reader.visits.getSnapshot()).toEqual([])
  reader.dispose()
})

it('publishes live reading preferences to an open Reader tab', () => {
  const reader = register()
  expect(reader.face?.translationTarget?.getSnapshot()).toBe('auto')
  expect(reader.face?.defaultCaptureWatermark?.()).toBe(false)
  reader.config.set({
    value: {
      historyLimit: 3,
      persistReadingState: true,
      defaultTranslationTarget: 'fr',
      captureWatermark: true,
    },
  })
  expect(reader.face?.translationTarget?.getSnapshot()).toBe('fr')
  expect(reader.face?.defaultCaptureWatermark?.()).toBe(true)
  reader.dispose()
})

it('leaves the native preview to the caller when chunk loading fails or access is denied', async () => {
  const reader = register()
  reader.readAccess.mockReturnValue(false)
  await expect(reader.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)).resolves.toBe(false)
  expect(loadPdf).not.toHaveBeenCalled()

  reader.readAccess.mockReturnValue(true)
  loadPdf.mockRejectedValue(new Error('PDF chunk unavailable'))
  await expect(reader.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)).resolves.toBe(false)
  expect(reader.openResourceIn).not.toHaveBeenCalled()
  reader.dispose()
})

it('cannot open a tab after Reader unmounts while chunks are loading', async () => {
  const reader = register()
  const pending = deferred<typeof runtime>()
  loadPdf.mockReturnValue(pending.promise)
  const opening = reader.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)
  reader.dispose()
  pending.resolve(runtime)

  await expect(opening).resolves.toBe(false)
  expect(reader.openResourceIn).not.toHaveBeenCalled()
})

it('rechecks workspace file access before opening a tab after the Reader chunks load', async () => {
  const reader = register()
  const pending = deferred<typeof runtime>()
  loadPdf.mockReturnValue(pending.promise)
  const opening = reader.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)
  reader.readAccess.mockReturnValue(false)
  pending.resolve(runtime)

  await expect(opening).resolves.toBe(false)
  expect(reader.openResourceIn).not.toHaveBeenCalled()
  reader.dispose()
})

it('binds workspace bytes to the exact attachment instance and rejects a partial file', async () => {
  const reader = register()
  const face = reader.face!
  await expect(face.resolve(REF, SIGNAL)).resolves.toEqual({ ref: REF, path: ATTACHMENT.path })
  await expect(face.read(SESSION, ATTACHMENT.path, SIGNAL)).resolves.toEqual(reader.bytes)
  expect(reader.readBytes).toHaveBeenCalledExactlyOnceWith(SESSION, ATTACHMENT.path, {}, SIGNAL)

  reader.zotero.resolveAttachment.mockResolvedValue({
    ok: true,
    value: {
      ...ATTACHMENT,
      ref: REF.replace('instance-a', 'instance-b'),
    },
  })
  await expect(face.resolve(REF, SIGNAL)).rejects.toThrow('unavailable')
  reader.readBytes.mockResolvedValue({
    ok: true,
    value: { offset: 0, eof: false, data: reader.bytes },
  })
  await expect(face.read(SESSION, ATTACHMENT.path, SIGNAL)).rejects.toThrow('unavailable')
  reader.dispose()
})

it('discards PDF and text bytes that finish after their Reader request is aborted', async () => {
  const reader = register()
  const face = reader.face!
  const pdfController = new AbortController()
  const pdfBytes = deferred<{
    ok: true
    value: { offset: number; eof: boolean; data: Uint8Array<ArrayBuffer> }
  }>()
  reader.readBytes.mockReturnValueOnce(pdfBytes.promise)
  const pdfRead = face.read(SESSION, ATTACHMENT.path, pdfController.signal)
  const pdfReason = new Error('PDF tab closed')
  pdfController.abort(pdfReason)
  pdfBytes.resolve({ ok: true, value: { offset: 0, eof: true, data: reader.bytes } })
  await expect(pdfRead).rejects.toBe(pdfReason)

  const textController = new AbortController()
  const textBytes = deferred<{
    ok: true
    value: { offset: number; eof: boolean; data: Uint8Array<ArrayBuffer> }
  }>()
  reader.readBytes.mockReturnValueOnce(textBytes.promise)
  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: true,
    value: { ...ATTACHMENT, contentType: 'text/plain' },
  })
  const textRead = face.readTextAttachment(SESSION, REF, textController.signal)
  await Promise.resolve()
  expect(reader.readBytes).toHaveBeenCalledTimes(2)
  const textReason = new Error('Text tab closed')
  textController.abort(textReason)
  textBytes.resolve({ ok: true, value: { offset: 0, eof: true, data: reader.bytes } })
  await expect(textRead).rejects.toBe(textReason)
  reader.dispose()
})

it('passes the Reader session and cancellation signal to parent details and note reads', async () => {
  const reader = register()
  const face = reader.face!
  const noteRef = itemRef(NOTE_KEY)
  const details = { ref: itemRef(), title: 'Paper', notes: { items: [{ ref: noteRef }] } }
  const note = { ref: noteRef, title: 'Findings', text: 'The sample was small.' }
  const detailsRequest = { sessionId: SESSION, ref: REF, offset: 0 }
  const noteRequest = { sessionId: SESSION, ref: noteRef }
  reader.zotero.readerDetails.mockResolvedValue({ ok: true, value: details })
  reader.zotero.readerNote.mockResolvedValue({ ok: true, value: note })
  await expect(face.details(detailsRequest, SIGNAL)).resolves.toBe(details)
  await expect(face.readNote(noteRequest, SIGNAL)).resolves.toBe(note)
  expect(reader.zotero.readerDetails).toHaveBeenCalledExactlyOnceWith(detailsRequest, SIGNAL)
  expect(reader.zotero.readerNote).toHaveBeenCalledExactlyOnceWith(noteRequest, SIGNAL)

  const refusal = { code: 'gateway/access-denied', message: 'Session access is required' }
  reader.zotero.readerDetails.mockResolvedValue({ ok: false, error: refusal })
  reader.zotero.readerNote.mockResolvedValue({ ok: false, error: refusal })
  await expect(face.details(detailsRequest, SIGNAL)).rejects.toBe(refusal)
  await expect(face.readNote(noteRequest, SIGNAL)).rejects.toBe(refusal)
  reader.dispose()
})

it('drops an attachment resolution that finishes after its tab closes', async () => {
  const reader = register()
  const face = reader.face!
  const controller = new AbortController()
  const pending = deferred<{ ok: true; value: typeof ATTACHMENT }>()
  reader.zotero.resolveAttachment.mockReturnValue(pending.promise)
  const resolved = face.resolve(REF, controller.signal)
  const reason = new Error('Reader tab closed')
  controller.abort(reason)
  pending.resolve({ ok: true, value: ATTACHMENT })

  await expect(resolved).rejects.toBe(reason)
  await expect(face.resolve(REF, controller.signal)).rejects.toBe(reason)
  expect(reader.zotero.resolveAttachment).toHaveBeenCalledExactlyOnceWith(REF)
  reader.dispose()
})

it('relays an ambiguous note receipt once with the session and tab cancellation signal', async () => {
  const reader = register()
  const request = {
    operation: 'create',
    sessionId: SESSION,
    ref: itemRef(),
    markdown: 'A verified finding.',
  } as const
  const receipt = { kind: 'committed-unverified', message: 'Check the note in Zotero.' }
  reader.zotero.readerWriteNote.mockResolvedValue({ ok: true, value: receipt })
  await expect(reader.face!.writeNote(request, SIGNAL)).resolves.toBe(receipt)
  expect(reader.zotero.readerWriteNote).toHaveBeenCalledExactlyOnceWith(request, SIGNAL)
  reader.dispose()
})
