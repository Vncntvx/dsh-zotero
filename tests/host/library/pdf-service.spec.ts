/** Downloads cross the public filesystem seam and retain bytes only for a reader lease. */
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ZoteroLibraryService } from '../../../src/library/service.js'
import type { ZoteroService } from '../../../src/service.js'
import { deferred } from '../../helpers/sync.js'

const { publicFetchMock } = vi.hoisted(() => ({ publicFetchMock: vi.fn() }))

vi.mock('../../../src/transport/connections.js', () => ({
  dnsAddressResolver: async () => [{ address: '93.184.216.34', family: 4 }],
  createPinnedDispatcher: () => ({ dispatcher: undefined, close: async () => {} }),
  publicFetch: publicFetchMock,
}))
import { publicFetch } from '../../../src/transport/connections.js'
const ref = 'zotero://user/0/attachment/ATTAC001?server=S1'
let context: Context | undefined
async function boot(fs = true, allowed = true) {
  context = new Context()
  // External core-service boundary: this spec owns URL reading, not Local API resolution.
  const resolveAttachment = vi.fn(async () => ({
    ref,
    title: 'paper.pdf',
    kind: 'url' as const,
    url: 'https://papers.example/paper.pdf',
    contentType: 'application/pdf',
  }))
  context.provide('zotero', {
    resolveAttachment,
  } as unknown as ZoteroService)
  if (fs) await context.plugin(LocalFileSystem, { cwd: tmpdir() })
  publicFetchMock.mockImplementation(
    async () => new Response('%PDF-1.7\nbody', { headers: { 'content-type': 'application/pdf' } }),
  )
  await context.plugin(ZoteroLibraryService, { allowUrlPdfRead: allowed })
  return { ctx: context, service: context.zoteroLibrary, resolveAttachment }
}
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
})
it('returns a verified readable file and removes its bytes on release', async () => {
  const { service } = await boot()
  const result = await service.readUrlPdf({ ref }, new AbortController().signal)
  // The reader fetches through the package's own undici copy, never the
  // runtime's global fetch: the composition must wire `publicFetch`.
  expect(vi.mocked(publicFetch)).toHaveBeenCalled()
  expect(await readFile(result.path, 'utf8')).toBe('%PDF-1.7\nbody')
  expect(result).toMatchObject({ ref, title: 'paper.pdf', contentType: 'application/pdf' })
  await expect(
    service.releaseUrlPdf({ lease: result.lease }, new AbortController().signal),
  ).resolves.toEqual({ released: true })
  await expect(stat(result.path)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('resolves the attachment once before fetching the URL PDF', async () => {
  const { service, resolveAttachment } = await boot()
  await service.readUrlPdf({ ref }, new AbortController().signal)
  expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(ref, expect.any(AbortSignal))
  expect(vi.mocked(publicFetch)).toHaveBeenCalledOnce()
})
it('refuses disabled permission before any download', async () => {
  const { service, resolveAttachment } = await boot(true, false)
  await expect(service.readUrlPdf({ ref }, new AbortController().signal)).rejects.toMatchObject({
    code: 'zotero/url-pdf',
    details: { code: 'ZOTERO_URL_PDF_DISABLED' },
  })
  expect(resolveAttachment).not.toHaveBeenCalled()
  expect(vi.mocked(publicFetch)).not.toHaveBeenCalled()
})
it('refuses a missing filesystem before any download', async () => {
  const { service } = await boot(false)
  await expect(service.readUrlPdf({ ref }, new AbortController().signal)).rejects.toThrow(
    'filesystem',
  )
  expect(vi.mocked(publicFetch)).not.toHaveBeenCalled()
})
it('removes a staged file if the filesystem cannot map its host path', async () => {
  const { service, ctx } = await boot()
  const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
  await expect(service.readUrlPdf({ ref }, new AbortController().signal)).rejects.toThrow(
    'cannot read host PDF',
  )
  await expect(stat(mapping.mock.calls[0]![0])).rejects.toMatchObject({ code: 'ENOENT' })
})
it('refuses a filesystem mapping to different bytes and removes the temporary file', async () => {
  const { service, ctx } = await boot()
  const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath')
  vi.spyOn(ctx.fs, 'fileUrl').mockReturnValue('file:///different.pdf')
  await expect(service.readUrlPdf({ ref }, new AbortController().signal)).rejects.toThrow(
    'verified mapping',
  )
  await expect(stat(mapping.mock.calls[0]![0])).rejects.toMatchObject({ code: 'ENOENT' })
})
it('rechecks permission after staging instead of exposing bytes after revocation', async () => {
  const { service, ctx } = await boot()
  const original = ctx.fs.resolve.bind(ctx.fs)
  const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath')
  vi.spyOn(ctx.fs, 'resolve').mockImplementation(async (...args) => {
    service.config = { ...service.config, allowUrlPdfRead: false }
    return original(...args)
  })
  await expect(service.readUrlPdf({ ref }, new AbortController().signal)).rejects.toMatchObject({
    code: 'zotero/url-pdf',
    details: { code: 'ZOTERO_URL_PDF_DISABLED' },
  })
  await expect(stat(mapping.mock.calls[0]![0])).rejects.toMatchObject({ code: 'ENOENT' })
})
it('lets a foreground download settle before plugin disposal removes its file', async () => {
  const { service, ctx } = await boot()
  const started = deferred<void>()
  const response = deferred<Response>()
  publicFetchMock.mockImplementation(async () => {
    started.resolve()
    return response.promise
  })
  const reading = service.readUrlPdf({ ref }, new AbortController().signal)
  await started.promise
  const disposed = ctx.fiber.dispose()
  response.resolve(
    new Response('%PDF-1.7\nbody', { headers: { 'content-type': 'application/pdf' } }),
  )
  const result = await reading
  await disposed
  await expect(stat(result.path)).rejects.toMatchObject({ code: 'ENOENT' })
})
