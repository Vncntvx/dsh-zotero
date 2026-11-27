import { Context, Service } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import type { ZoteroReaderTranslateRequest } from '../../src/contract.js'
import { ReaderService } from '../../src/reader/service.js'

const request = { sessionId: 'session-reader', text: 'Limited excerpt', target: 'fr' } as const
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function host(chunks: readonly StreamChunk[]) {
  const ctx = new Context()
  contexts.push(ctx)
  const allows = vi.fn(() => true)
  const stream = vi.fn(async function* (_options: GenerateOptions) {
    yield* chunks
  })
  const prepareCall = vi.fn(async (config: GenerateOptions) => ({ config, stream }))
  class Access extends Service {
    constructor(context: Context) {
      super(context, 'remoteAccess')
    }
    allows = allows
  }
  class Agents extends Service {
    constructor(context: Context) {
      super(context, 'agents')
    }
    get = vi.fn(() => ({
      status: 'idle',
      model: { current: () => ({ provider: 'test', model: 'technical-translation' }) },
      ctx: { get: () => ({ prepareCall }) },
    }))
  }
  // The registry exposes the same Agent object throughout the model request.
  const agents = new Agents(ctx)
  const agent = agents.get()
  agents.get.mockReturnValue(agent)
  const resolveAgent = vi.fn(async () => ({ agent }))
  class SessionController extends Service {
    constructor(context: Context) {
      super(context, 'sessionController')
    }
    resolveAgent = resolveAgent
  }
  new SessionController(ctx)
  new Access(ctx)
  return { reader: new ReaderService(ctx), allows, prepareCall, stream, resolveAgent }
}

it('sends only the selected text to the session model and returns visible translation blocks', async () => {
  const { reader, prepareCall, stream, resolveAgent } = host([
    { type: 'reasoning-delta', index: 0, text: 'Hidden reasoning' },
    { type: 'text-delta', index: 1, text: 'Extrait ' },
    { type: 'text-delta', index: 1, text: 'limité' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  await expect(reader.readerTranslate(request, new AbortController().signal)).resolves.toBe(
    'Extrait limité',
  )
  expect(resolveAgent).toHaveBeenCalledExactlyOnceWith(request.sessionId)
  expect(prepareCall).toHaveBeenCalledExactlyOnceWith(
    { provider: 'test', model: 'technical-translation', maxTokens: 4096 },
    expect.any(AbortSignal),
  )
  expect(stream).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      messages: [{ role: 'user', content: [{ type: 'text', text: request.text }] }],
      sessionId: request.sessionId,
      system: expect.stringContaining('French'),
      purpose: 'zotero-reader-translation',
    }),
  )
  expect(stream.mock.calls[0]?.[0].tools).toBeUndefined()
})

it('denies a session without access before preparing a provider request', async () => {
  const { reader, allows, prepareCall } = host([])
  allows.mockReturnValue(false)
  await expect(reader.readerTranslate(request, new AbortController().signal)).rejects.toMatchObject(
    { code: 'remote-access/denied' },
  )
  expect(prepareCall).not.toHaveBeenCalled()
})

it('keeps the excerpt local if session access is revoked during model preparation', async () => {
  const { reader, allows, prepareCall, stream } = host([])
  allows.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false)
  await expect(reader.readerTranslate(request, new AbortController().signal)).rejects.toMatchObject(
    {
      message: 'Translation failed. Check the session model and try again.',
    },
  )
  expect(prepareCall).toHaveBeenCalledOnce()
  expect(stream).not.toHaveBeenCalled()
})

it.each([
  { ...request, text: 'a'.repeat(8_001) },
  { ...request, text: ' ' },
  { ...request, target: 'unsupported' } as unknown as ZoteroReaderTranslateRequest,
])('refuses invalid input before preparing a provider request', async (invalid) => {
  const { reader, prepareCall } = host([])
  await expect(reader.readerTranslate(invalid, new AbortController().signal)).rejects.toMatchObject(
    { code: 'zotero/invalid-argument' },
  )
  expect(prepareCall).not.toHaveBeenCalled()
})

it('rejects partial translation when the model token limit is reached', async () => {
  const { reader } = host([
    { type: 'text-delta', index: 0, text: 'Extrait' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
  await expect(reader.readerTranslate(request, new AbortController().signal)).rejects.toMatchObject(
    { message: 'Translation failed. Check the session model and try again.' },
  )
})

it('requests a bounded annotation comment using only selected text and no tools', async () => {
  const { reader, prepareCall, stream } = host([
    { type: 'reasoning-delta', index: 0, text: 'Ignored reasoning' },
    { type: 'text-delta', index: 1, text: 'The trial has a small sample.' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const { sessionId, text } = request
  await expect(
    reader.readerSuggestAnnotation({ sessionId, text }, new AbortController().signal),
  ).resolves.toBe('The trial has a small sample.')
  expect(prepareCall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ maxTokens: 512 }),
    expect.any(AbortSignal),
  )
  expect(stream).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      purpose: 'zotero-reader-annotation-suggestion',
      system: expect.stringContaining('plain-text comment'),
    }),
  )
  expect(stream.mock.calls[0]?.[0].tools).toBeUndefined()
})
