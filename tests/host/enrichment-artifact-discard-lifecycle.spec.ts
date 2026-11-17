/** Artifact deletion drains its generation before removing data and durable receipts. */
import { afterEach, expect, it, vi } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { realpath } from 'node:fs/promises'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { discardParsedDocument } from '../../src/enrichment/artifact-management.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { deferred } from '../helpers/sync.ts'
import {
  parseJobsFixture,
  parsedResult,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
  PARSE_URL,
} from './support/enrichment-parse-jobs.ts'

let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})

it('cancels and drains a parser paused between directory commit and source publication', async () => {
  const committed = deferred<ReturnType<typeof parsedResult>>(),
    publish = deferred<void>(),
    aborted = deferred<void>()
  fixture = await parseJobsFixture({
    execute: async (execution) => {
      const result = parsedResult(execution)
      const store = new ParsedArtifactStore(await realpath(fixture!.root))
      await store.put(result.cacheKey, result.artifact)
      execution.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      committed.resolve(result)
      // This source deliberately does not cooperate until its owned release.
      await publish.promise
      await store.putSources(
        [sourceKeyOf(execution.input.key)],
        {
          version: 2,
          cacheKey: result.cacheKey,
          fingerprint: result.provenance.fingerprint,
          generation: execution.generation,
          parser: 'mineru',
          format: 'markdown',
          stamp: result.stamp,
        },
        execution.signal,
      )
      return result
    },
  })
  const host = fixture
  const request = parseRequest()
  const started = await host.helper.startDocumentParse(request, parseSignal())
  const result = await committed.promise
  const store = new ParsedArtifactStore(await realpath(host.root))
  let returned = false
  const removal = discardParsedDocument(
    {
      config: () => host.config.value,
      store: async () => store,
      persistence: host.persistence,
      jobs: host.helper,
    },
    result.cacheKey,
  ).then((value) => {
    returned = true
    return value
  })
  void removal.catch(() => {})
  try {
    await aborted.promise
    expect(returned).toBe(false)
    expect(await store.hasArtifactDirectory(result.cacheKey)).toBe(true)
    await expect(host.helper.startDocumentParse(request, parseSignal())).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
    })
    await expect(
      discardParsedDocument(
        {
          config: () => host.config.value,
          store: async () => store,
          persistence: host.persistence,
          jobs: host.helper,
        },
        result.cacheKey,
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT' })
    publish.resolve()
    // The operation receipt and its generation pointer are both removed.
    expect(await removal).toMatchObject({ kind: 'discarded', removedReceipts: 2 })
    expect(await store.hasArtifactDirectory(result.cacheKey)).toBe(false)
    expect((await store.groupByArtifact()).has(result.cacheKey)).toBe(false)
    await expect(
      host.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
    expect(
      (await host.ctx.jobs.wait(JobId(started.jobId), 5000, SessionId(request.sessionId))).status,
    ).toBe('killed')
  } finally {
    publish.resolve()
    await removal.catch(() => {})
  }
})

it('refuses a durable replay whose receipt read finishes after deletion has completed', async () => {
  fixture = await parseJobsFixture()
  const host = fixture,
    request = parseRequest()
  const first = await host.helper.startDocumentParse(request, parseSignal())
  await host.ctx.jobs.wait(JobId(first.jobId), 5000, SessionId(request.sessionId))
  const result = parsedResult({
    input: { key: PARSE_URL, source: { kind: 'url', url: PARSE_URL } },
    config: host.config.value,
    generation: first.generation,
  })
  const store = new ParsedArtifactStore(await realpath(host.root))
  await store.put(result.cacheKey, result.artifact)
  const entered = deferred<void>(),
    release = deferred<void>()
  const originalGet = host.persistence.get.bind(host.persistence)
  vi.spyOn(host.persistence, 'get').mockImplementationOnce(async (...args) => {
    const record = await originalGet(...args)
    entered.resolve()
    await release.promise
    return record
  })
  const remounted = host.remount()
  const replay = remounted.startDocumentParse(request, parseSignal())
  const refused = expect(replay).rejects.toMatchObject({
    code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
  })
  try {
    await entered.promise
    expect(
      await discardParsedDocument(
        {
          config: () => host.config.value,
          store: async () => store,
          persistence: host.persistence,
          jobs: remounted,
        },
        result.cacheKey,
      ),
    ).toMatchObject({ kind: 'discarded' })
    release.resolve()
    await refused
    expect(host.ctx.jobs.list(SessionId(request.sessionId))).toHaveLength(1)
    await expect(
      remounted.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
  } finally {
    release.resolve()
    await replay.catch(() => {})
  }
})

it('releases the generation reservation when filesystem deletion fails, allowing a complete retry', async () => {
  fixture = await parseJobsFixture()
  const host = fixture,
    request = parseRequest()
  const first = await host.helper.startDocumentParse(request, parseSignal())
  await host.ctx.jobs.wait(JobId(first.jobId), 5000, SessionId(request.sessionId))
  const result = parsedResult({
    input: { key: PARSE_URL, source: { kind: 'url', url: PARSE_URL } },
    config: host.config.value,
    generation: first.generation,
  })
  const store = new ParsedArtifactStore(await realpath(host.root))
  await store.put(result.cacheKey, result.artifact)
  const deps = {
    config: () => host.config.value,
    store: async () => store,
    persistence: host.persistence,
    jobs: host.helper,
  }
  vi.spyOn(store, 'discardArtifact').mockRejectedValueOnce(
    new Error('EACCES: directory deletion refused'),
  )
  await expect(discardParsedDocument(deps, result.cacheKey)).rejects.toMatchObject({
    code: 'ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED',
  })
  expect(await store.hasArtifactDirectory(result.cacheKey)).toBe(true)
  expect(await discardParsedDocument(deps, result.cacheKey)).toMatchObject({ kind: 'discarded' })
  expect(await store.hasArtifactDirectory(result.cacheKey)).toBe(false)
})

it('drains only the removed generation while another document continues to publish', async () => {
  const first = {
    committed: deferred<ReturnType<typeof parsedResult>>(),
    release: deferred<void>(),
    aborted: deferred<void>(),
  }
  const second = {
    committed: deferred<ReturnType<typeof parsedResult>>(),
    release: deferred<void>(),
    aborted: false,
  }
  fixture = await parseJobsFixture({
    execute: async (execution) => {
      const isFirst = execution.input.key === PARSE_URL
      const slot = isFirst ? first : second
      const result = parsedResult(execution, `# Parsed document\n${execution.input.key}`)
      const store = new ParsedArtifactStore(await realpath(fixture!.root))
      await store.put(result.cacheKey, result.artifact)
      execution.signal.addEventListener(
        'abort',
        () => {
          if (isFirst) first.aborted.resolve()
          else second.aborted = true
        },
        { once: true },
      )
      slot.committed.resolve(result)
      await slot.release.promise
      await store.putSources(
        [sourceKeyOf(execution.input.key)],
        {
          version: 2,
          cacheKey: result.cacheKey,
          fingerprint: result.provenance.fingerprint,
          generation: execution.generation,
          parser: 'mineru',
          format: 'markdown',
          stamp: result.stamp,
        },
        execution.signal,
      )
      return result
    },
  })
  const host = fixture,
    request = parseRequest()
  await host.helper.startDocumentParse(request, parseSignal())
  const a = await first.committed.promise
  const other = await host.helper.startDocumentParse(
    parseRequest(undefined, {
      target: { kind: 'url', url: 'https://papers.example.org/second.pdf' },
    }),
    parseSignal(),
  )
  const b = await second.committed.promise
  const store = new ParsedArtifactStore(await realpath(host.root))
  const removal = discardParsedDocument(
    {
      config: () => host.config.value,
      store: async () => store,
      persistence: host.persistence,
      jobs: host.helper,
    },
    a.cacheKey,
  )
  void removal.catch(() => {})
  try {
    await first.aborted.promise
    expect(second.aborted).toBe(false)
    first.release.resolve()
    expect(await removal).toMatchObject({ kind: 'discarded' })
    second.release.resolve()
    expect(
      (await host.ctx.jobs.wait(JobId(other.jobId), 5000, SessionId(request.sessionId))).status,
    ).toBe('completed')
    const groups = await store.groupByArtifact()
    expect(groups.has(a.cacheKey)).toBe(false)
    expect(groups.get(b.cacheKey)?.aliases).toHaveLength(1)
    expect(await store.get(b.cacheKey)).toBeDefined()
  } finally {
    first.release.resolve()
    second.release.resolve()
    await removal.catch(() => {})
  }
})
