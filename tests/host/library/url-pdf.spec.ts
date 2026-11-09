/** User reading has its own permission and validates every network hop. */
import { afterEach, expect, it, vi } from 'vitest'
import { UrlPdfReader, URL_PDF_MAX_BYTES } from '../../../src/library/url-pdf.js'
import type { UrlPdfDependencies } from '../../../src/library/url-pdf.js'
import { deferred } from '../../helpers/sync.js'

const ref = 'zotero://user/0/attachment/ATTAC001?server=S1'
const attachment = {
  ref,
  title: 'paper.pdf',
  contentType: 'application/pdf',
  kind: 'url',
  url: 'https://papers.example/document.pdf',
} as const
const signal = () => new AbortController().signal
function setup(overrides: Partial<UrlPdfDependencies> = {}) {
  const close = vi.fn(async () => {})
  const dependencies: UrlPdfDependencies = {
    allowed: () => true,
    resolver: vi.fn<UrlPdfDependencies['resolver']>(async () => [
      { address: '93.184.216.34', family: 4 },
    ]),
    dispatcher: vi.fn(() => ({ dispatcher: undefined, close })),
    fetch: vi.fn(
      async () =>
        new Response('%PDF-1.7\nbody', { headers: { 'content-type': 'application/pdf' } }),
    ),
    ...overrides,
  }
  return { reader: new UrlPdfReader(dependencies), dependencies, close }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('refuses before resolving an attachment when reading permission is off', async () => {
  const { reader, dependencies } = setup({ allowed: () => false })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_DISABLED',
  })
  expect(dependencies.resolver).not.toHaveBeenCalled()
  expect(dependencies.fetch).not.toHaveBeenCalled()
})
it('returns complete PDF bytes with pinned addresses and no browser credentials', async () => {
  const { reader, dependencies, close } = setup()
  const result = await reader.read(attachment, signal())
  expect(new TextDecoder().decode(result.data)).toBe('%PDF-1.7\nbody')
  expect(dependencies.dispatcher).toHaveBeenCalledWith([{ address: '93.184.216.34', family: 4 }])
  expect(dependencies.fetch).toHaveBeenCalledWith(
    'https://papers.example/document.pdf',
    expect.objectContaining({
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }),
  )
  expect(close).toHaveBeenCalledTimes(1)
})
it('resolves and pins a new public host on redirect', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example/paper.pdf' } }),
    )
    .mockResolvedValueOnce(new Response(new TextEncoder().encode('%PDF-1.7\nbody')))
  const { reader, dependencies, close } = setup({ fetch })
  await reader.read(attachment, signal())
  expect(dependencies.resolver).toHaveBeenCalledWith('cdn.example', expect.any(AbortSignal))
  expect(close).toHaveBeenCalledTimes(2)
})
it.each([
  'http://127.0.0.1/private',
  'https://10.0.0.1/private',
  'http://papers.example/downgrade',
  'https://user:secret@papers.example/paper',
  'https://papers.example:23119/paper',
])('refuses unsafe redirect %s before contacting it', async (location) => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 302, headers: { location } }),
  )
  const { reader } = setup({ fetch })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_FORBIDDEN_TARGET',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('refuses private DNS answers before creating a dispatcher', async () => {
  const { reader, dependencies } = setup({
    resolver: async () => [{ address: '192.168.1.10', family: 4 }],
  })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_FORBIDDEN_TARGET',
  })
  expect(dependencies.dispatcher).not.toHaveBeenCalled()
})
it('refuses site-local IPv6 DNS answers before creating a dispatcher', async () => {
  const { reader, dependencies } = setup({
    resolver: async () => [{ address: 'fec0::1', family: 6 }],
  })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_FORBIDDEN_TARGET',
  })
  expect(dependencies.dispatcher).not.toHaveBeenCalled()
  expect(dependencies.fetch).not.toHaveBeenCalled()
})
it.each([
  [
    'HTML challenge',
    () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    'NOT_PDF',
  ],
  [
    'false PDF type',
    () => new Response('not a pdf', { headers: { 'content-type': 'application/pdf' } }),
    'NOT_PDF',
  ],
  [
    'declared oversized PDF',
    () => new Response('', { headers: { 'content-length': String(URL_PDF_MAX_BYTES + 1) } }),
    'TOO_LARGE',
  ],
  ['HTTP refusal', () => new Response(null, { status: 403 }), 'HTTP'],
] as const)('reports %s without returning a partial document', async (_name, response, code) => {
  const { reader, close } = setup({ fetch: async () => response() })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: `ZOTERO_URL_PDF_${code}`,
  })
  expect(close).toHaveBeenCalledTimes(1)
})
it('enforces the streaming cap without Content-Length', async () => {
  const { reader } = setup({
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(URL_PDF_MAX_BYTES + 1))
            controller.close()
          },
        }),
      ),
  })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_TOO_LARGE',
  })
})
it('revokes a running download immediately', async () => {
  let allowed = true
  const started = deferred<void>()
  const { reader } = setup({
    allowed: () => allowed,
    fetch: async (_url, init) => {
      started.resolve()
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
      )
    },
  })
  const failure = expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_DISABLED',
  })
  await started.promise
  allowed = false
  reader.revoke()
  await failure
})
it('redacts signed URLs from transport failures', async () => {
  const { reader } = setup({
    fetch: async () => {
      throw new Error('https://publisher.example/?token=secret')
    },
  })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_NETWORK',
    message: expect.not.stringContaining('secret'),
  })
})
it('stops repeated redirects at the documented bound', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 302, headers: { location: '/again' } }),
  )
  const { reader } = setup({ fetch })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_REDIRECT',
  })
  expect(fetch).toHaveBeenCalledTimes(6)
})
it('refuses an HTML response that embeds a PDF signature', async () => {
  const { reader } = setup({
    fetch: async () =>
      new Response('<!doctype html><script>"%PDF-1.7"</script>', {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  })
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_NOT_PDF',
  })
})
it('rejects a third download and returns capacity after caller cancellation', async () => {
  const started = deferred<void>()
  let count = 0
  const { reader, dependencies } = setup({
    fetch: vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (++count === 2) started.resolve()
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
      )
    }),
  })
  const controller = new AbortController()
  const one = expect(reader.read(attachment, controller.signal)).rejects.toThrow('caller stopped')
  const two = expect(reader.read(attachment, controller.signal)).rejects.toThrow('caller stopped')
  await started.promise
  await expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_BUSY',
  })
  controller.abort(new Error('caller stopped'))
  await Promise.all([one, two])
  vi.mocked(dependencies.fetch).mockResolvedValue(
    new Response('%PDF-1.7\nbody', { headers: { 'content-type': 'application/pdf' } }),
  )
  await expect(reader.read(attachment, signal())).resolves.toMatchObject({ ref })
})
it('maps its owned 60 second deadline to a timeout error', async () => {
  const deadline = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const started = deferred<void>()
  const { reader } = setup({
    fetch: async (_url, init) => {
      started.resolve()
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
      )
    },
  })
  const failure = expect(reader.read(attachment, signal())).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_TIMEOUT',
  })
  await started.promise
  deadline.abort(new Error('deadline'))
  await failure
  expect(timeout).toHaveBeenCalledWith(60_000)
})
it('refuses local attachments without contacting an external host', async () => {
  const { reader, dependencies } = setup()
  await expect(
    reader.read(
      { ref, title: 'local.pdf', contentType: 'application/pdf', kind: 'file', path: '/local.pdf' },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'ZOTERO_URL_PDF_NOT_URL' })
  expect(dependencies.fetch).not.toHaveBeenCalled()
})
