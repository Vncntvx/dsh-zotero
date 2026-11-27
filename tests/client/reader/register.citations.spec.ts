import { expect, it } from 'vitest'
import { parsedArtifactTabAddress } from '../../../src/client/parsed-tab.ts'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { deferred } from '../../helpers/sync.ts'
import { itemRef, NOTE_KEY } from '../../helpers/server/keys.ts'
import { ATTACHMENT, REF, SESSION, SIGNAL, loadPdf, register } from './support/register.ts'

const digest = 'a'.repeat(64)
const source = {
  attachmentRef: REF,
  libraryRef: 'zotero://user/0/',
  title: ATTACHMENT.title,
  fingerprint: `sha256:${digest}`,
}
const artifact = { kind: 'ready', sourceRef: REF, fingerprint: digest, artifactId: 'cached-doc' }

it('opens only a ready artifact with the same attachment identity and full PDF fingerprint', async () => {
  const reader = register()
  const open = reader.face!.openParsedPassage!
  const selection = { quote: 'Methods and findings' }
  for (const value of [
    { kind: 'missing' },
    { ...artifact, sourceRef: REF.replace('instance-a', 'instance-b') },
    { ...artifact, fingerprint: 'b'.repeat(64) },
  ]) {
    reader.zotero.documentArtifact.mockResolvedValueOnce({ ok: true, value })
    await expect(open(SESSION, source, selection, SIGNAL)).resolves.toBe(false)
  }
  expect(reader.openResourceIn).not.toHaveBeenCalled()
  reader.zotero.documentArtifact.mockResolvedValueOnce({ ok: true, value: artifact })
  await expect(open(SESSION, source, selection, SIGNAL)).resolves.toBe(true)
  expect(reader.zotero.documentArtifact).toHaveBeenLastCalledWith(
    { sessionId: SESSION, op: 'inspect', target: { kind: 'attachment', ref: REF } },
    SIGNAL,
  )
  expect(reader.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    parsedArtifactTabAddress({ sessionId: SESSION, artifactId: artifact.artifactId }),
    {
      destination: 'sidebar',
      params: {
        title: source.title,
        parsedPassage: { ...selection, attachmentRef: REF, fingerprint: digest },
      },
    },
  )
  reader.dispose()
})

it('abandons a cached passage if the tab closes or the session grant is removed during inspection', async () => {
  const reader = register()
  const open = reader.face!.openParsedPassage!
  const selection = { quote: 'Methods and findings' }
  const first = deferred<{ ok: true; value: typeof artifact }>()
  reader.zotero.documentArtifact.mockReturnValueOnce(first.promise)
  const controller = new AbortController()
  const aborted = open(SESSION, source, selection, controller.signal)
  const reason = new Error('Reader closed')
  controller.abort(reason)
  first.resolve({ ok: true, value: artifact })
  await expect(aborted).rejects.toBe(reason)

  const second = deferred<{ ok: true; value: typeof artifact }>()
  reader.zotero.documentArtifact.mockReturnValueOnce(second.promise)
  const revoked = open(SESSION, source, selection, SIGNAL)
  reader.readAccess.mockReturnValue(false)
  second.resolve({ ok: true, value: artifact })
  await expect(revoked).resolves.toBe(false)
  await expect(open(SESSION, source, selection, SIGNAL)).resolves.toBe(false)
  expect(reader.zotero.documentArtifact).toHaveBeenCalledTimes(2)
  expect(reader.openResourceIn).not.toHaveBeenCalled()
  reader.dispose()
})

it('passes the cited note version and exact text revision when reopening historical citations', async () => {
  const reader = register()
  const { openCitation } = reader.citations
  const noteRef = itemRef(NOTE_KEY)
  const note = { noteRef, title: 'Findings', noteVersion: 9 }
  await expect(openCitation(SESSION, note, SIGNAL)).resolves.toBe(true)
  expect(reader.openResourceIn).toHaveBeenLastCalledWith(
    SESSION,
    readerAddress(SESSION, noteRef, 'note'),
    { destination: 'sidebar', params: { title: note.title, noteVersion: 9 } },
  )

  const selection = {
    documentType: 'markdown',
    textRange: { start: 4, end: 12 },
    fingerprint: source.fingerprint,
  } as const
  await expect(openCitation(SESSION, { ...source, ...selection }, SIGNAL)).resolves.toBe(false)
  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: true,
    value: { ...ATTACHMENT, contentType: 'text/markdown' },
  })
  await expect(openCitation(SESSION, { ...source, ...selection }, SIGNAL)).resolves.toBe(true)
  expect(reader.openResourceIn).toHaveBeenLastCalledWith(
    SESSION,
    readerAddress(SESSION, REF, 'text'),
    { destination: 'sidebar', params: { title: ATTACHMENT.title, textCitation: selection } },
  )
  expect(loadPdf).not.toHaveBeenCalled()
  reader.dispose()
})

it('reopens a cached text range only while its session may read the artifact', async () => {
  const reader = register()
  const { openCitation } = reader.citations
  const passage = {
    attachmentRef: REF,
    fingerprint: digest,
    textRange: { start: 7, end: 14 },
    textPrefix: 'results',
  }
  const title = 'Cached passage'
  const artifactId = 'b'.repeat(64)
  const citation = { ...passage, title, artifactId }
  reader.readAccess.mockReturnValue(false)
  await expect(openCitation(SESSION, citation, SIGNAL)).resolves.toBe(false)
  reader.readAccess.mockReturnValue(true)
  await expect(openCitation(SESSION, citation, AbortSignal.abort())).resolves.toBe(false)
  await expect(openCitation(SESSION, citation, SIGNAL)).resolves.toBe(true)
  reader.dispose()
  await expect(openCitation(SESSION, citation, SIGNAL)).resolves.toBe(false)
  expect(reader.openResourceIn).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    parsedArtifactTabAddress({ sessionId: SESSION, artifactId }),
    { destination: 'sidebar', params: { title, parsedPassage: passage } },
  )
  expect(reader.zotero.documentArtifact).not.toHaveBeenCalled()
  expect(loadPdf).not.toHaveBeenCalled()
})

it('prepares the result note for a writable parent and rechecks grants after loading the editor', async () => {
  const reader = register()
  const { prepareNote } = reader.citations
  const item = { ref: itemRef(), title: 'The parent article' }
  reader.zotero.readerDetails.mockResolvedValueOnce({ ok: true, value: item })
  await expect(prepareNote(SESSION, source, SIGNAL)).resolves.toBeUndefined()
  reader.zotero.readerDetails.mockResolvedValue({
    ok: true,
    value: { ...item, noteWriteEnabled: true },
  })
  await expect(prepareNote(SESSION, source, SIGNAL)).resolves.toMatchObject({
    ...item,
    write: reader.face!.writeNote,
  })
  expect(reader.zotero.readerDetails).toHaveBeenLastCalledWith(
    { sessionId: SESSION, ref: REF, offset: 0 },
    SIGNAL,
  )

  const detail = deferred<{ ok: true; value: typeof item & { noteWriteEnabled: boolean } }>()
  reader.zotero.readerDetails.mockReturnValueOnce(detail.promise)
  const preparing = prepareNote(SESSION, source, SIGNAL)
  reader.readAccess.mockReturnValue(false)
  detail.resolve({ ok: true, value: { ...item, noteWriteEnabled: true } })
  await expect(preparing).resolves.toBeUndefined()
  expect(reader.zotero.readerWriteNote).not.toHaveBeenCalled()
  reader.dispose()
})
