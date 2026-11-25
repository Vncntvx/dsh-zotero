import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ZoteroLibraryService } from '../../../src/library/service.js'
import type { ZoteroService } from '../../../src/service.js'
import { deferred } from '../../helpers/sync.js'
import { withTempDir } from '../../helpers/temp-dir.js'

const { fetch, routeFor } = vi.hoisted(() => ({
  fetch: vi.fn<typeof globalThis.fetch>(),
  routeFor: vi.fn<(url: URL) => { proxied: false } | { proxied: true; dispatcher: unknown }>(),
}))
vi.mock('../../../src/transport/connections.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/transport/connections.js')>()),
  publicFetch: fetch,
  egressRouteFor: routeFor,
}))

const request = { publicationName: 'Journal', priority: 'detail' } as const
const ref = 'EASYSCHOLAR_SECRET_KEY'
let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.resetAllMocks()
})

async function boot(credential: string | undefined, allowed = true) {
  const ctx = (context = new Context())
  const resolve = vi.fn(async () => (credential ? { value: credential } : undefined))
  ctx.provide('credentials', { resolve } as unknown as Context['credentials'])
  ctx.provide('zotero', {} as ZoteroService)
  await ctx.plugin(ZoteroLibraryService, { journalMetricsEnabled: allowed })
  const read = () => ctx.zoteroLibrary.journalMetrics(request, new AbortController().signal)
  return { ctx, read, resolve }
}

it.each([false, true])(
  'sends a credential only to the fixed endpoint with proxied=%s',
  async (proxied) => {
    const dispatcher = {}
    routeFor.mockReturnValue(proxied ? { proxied, dispatcher } : { proxied })
    const { read, resolve } = await boot('host-key')
    fetch.mockResolvedValueOnce(Response.redirect('https://elsewhere.example/'))

    await expect(read()).resolves.toEqual({ status: 'invalidResponse' })
    expect(resolve).toHaveBeenCalledExactlyOnceWith(ref)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        origin: 'https://www.easyscholar.cc',
        pathname: '/open/getPublicationRank',
        search: '?publicationName=Journal&secretKey=host-key',
      }),
      expect.objectContaining({
        dispatcher: proxied ? dispatcher : expect.anything(),
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    )
  },
)

it('reads neither the credential nor the provider when journal lookup is disabled', async () => {
  const { ctx, read, resolve } = await boot('host-key', false)
  await expect(read()).resolves.toEqual({ status: 'disabled' })
  await expect(
    ctx.zoteroLibrary.refreshJournalMetrics({}, new AbortController().signal),
  ).resolves.toEqual({
    status: 'disabled',
  })
  expect(resolve).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('aborts the provider request when the credential changes', async () => {
  const { ctx, read } = await boot('host-key')
  routeFor.mockReturnValue({ proxied: false })
  const started = deferred<AbortSignal>()
  fetch.mockImplementationOnce(async (_url, init) => {
    const signal = init!.signal!
    started.resolve(signal)
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const pending = read()
  const signal = await started.promise
  ctx.emit('credentials/reference-updated', credentialRef(ref))
  await expect(pending).resolves.toEqual({ status: 'disabled' })
  expect(signal.aborted).toBe(true)
})

it('reports a cache write failure without exposing the credential', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'cache'), '')
    vi.stubEnv('DSH_HOME', dir)
    try {
      const { ctx, read } = await boot('host-key')
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      routeFor.mockReturnValue({ proxied: false })
      fetch.mockResolvedValueOnce(
        Response.json({ code: 200, data: { officialRank: { all: { sci: 'Q1' } } } }),
      )
      await expect(read()).resolves.toMatchObject({ status: 'ready' })
      await ctx.fiber.dispose()
      context = undefined
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'Could not save EasyScholar metrics to the host cache.',
      )
      warn.mockRestore()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
