/** Reading files have private permissions and explicit lifetime ownership. */
import { readFile, stat } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { PdfReadingFiles } from '../../../src/library/pdf-files.js'
const stores: PdfReadingFiles[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
})
it('keeps complete private bytes until their lease is released', async () => {
  const store = new PdfReadingFiles()
  stores.push(store)
  const file = await store.stage(
    new TextEncoder().encode('%PDF-1.7\nbody'),
    new AbortController().signal,
  )
  expect(await readFile(file.path, 'utf8')).toBe('%PDF-1.7\nbody')
  expect((await stat(file.path)).mode & 0o777).toBe(0o600)
  await store.release(file.lease)
  await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await store.release(file.lease)
})
it('removes every reading file on plugin disposal', async () => {
  const store = new PdfReadingFiles()
  stores.push(store)
  const file = await store.stage(new Uint8Array([1]), new AbortController().signal)
  await store.dispose()
  await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(store.stage(new Uint8Array(), new AbortController().signal)).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_BUSY',
  })
})
it('refuses an aborted request before allocating a file', async () => {
  const store = new PdfReadingFiles()
  stores.push(store)
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(store.stage(new Uint8Array(), controller.signal)).rejects.toThrow('cancelled')
})
