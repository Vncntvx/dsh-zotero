import { expect, it } from 'vitest'
import { ATTACHMENT, REF, SESSION, SIGNAL, register } from './support/register.ts'

it('refuses unsupported attachments, revoked access, and failed reader reads', async () => {
  const reader = register()
  const textAttachment = {
    ...ATTACHMENT,
    ref: REF.replace('ABCD1234', 'TEXT1234'),
    contentType: 'text/markdown',
    path: 'notes.md',
  }
  await expect(
    reader.open(SESSION, { ...ATTACHMENT, kind: 'url' }, 'sidebar', SIGNAL),
  ).resolves.toBe(false)
  await expect(
    reader.open(SESSION, textAttachment, 'sidebar', SIGNAL, {
      quote: 'not a PDF',
      sourceType: 'selection',
    }),
  ).resolves.toBe(false)
  await expect(
    reader.open(SESSION, textAttachment, 'sidebar', SIGNAL, undefined, undefined, {
      documentType: 'html',
      textRange: { start: 0, end: 1 },
    }),
  ).resolves.toBe(false)
  reader.readAccess.mockReturnValue(false)
  await expect(reader.open(SESSION, ATTACHMENT, 'sidebar', SIGNAL)).resolves.toBe(false)
  reader.readAccess.mockReturnValue(true)

  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: false,
    error: new Error('resolve refused'),
  })
  await expect(reader.face!.resolve(REF, SIGNAL)).rejects.toThrow('resolve refused')
  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: true,
    value: { ...ATTACHMENT, kind: 'url', path: undefined, contentType: 'text/html' },
  })
  await expect(reader.face!.resolve(REF, SIGNAL)).rejects.toThrow()

  reader.readBytes.mockResolvedValueOnce({ ok: false, error: new Error('read refused') })
  await expect(reader.face!.read(SESSION, 'paper.pdf', SIGNAL)).rejects.toThrow('read refused')
  reader.readBytes.mockResolvedValueOnce({
    ok: true,
    value: { offset: 1, eof: true, data: reader.bytes },
  })
  await expect(reader.face!.read(SESSION, 'paper.pdf', SIGNAL)).rejects.toThrow()
  reader.readBytes.mockResolvedValueOnce({
    ok: true,
    value: { offset: 0, eof: false, data: reader.bytes },
  })
  await expect(reader.face!.read(SESSION, 'paper.pdf', SIGNAL)).rejects.toThrow()
  await expect(reader.face!.read(SESSION, 'paper.pdf', SIGNAL)).resolves.toEqual(reader.bytes)

  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: false,
    error: new Error('text resolve refused'),
  })
  await expect(reader.face!.readTextAttachment(SESSION, REF, SIGNAL)).rejects.toThrow(
    'text resolve refused',
  )
  reader.zotero.resolveAttachment.mockResolvedValueOnce({
    ok: true,
    value: { ...ATTACHMENT, kind: 'url', contentType: 'text/html', path: undefined },
  })
  await expect(reader.face!.readTextAttachment(SESSION, REF, SIGNAL)).rejects.toThrow()
  reader.zotero.resolveAttachment.mockResolvedValueOnce({ ok: true, value: textAttachment })
  await expect(
    reader.face!.readTextAttachment(SESSION, textAttachment.ref, SIGNAL),
  ).resolves.toMatchObject({ format: 'markdown' })
  reader.dispose()
})
